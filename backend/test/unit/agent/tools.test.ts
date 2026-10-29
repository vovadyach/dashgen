import assert from "node:assert/strict";
import { test } from "node:test";

import { Outcome } from "@dashgen/contracts";
import { z } from "zod";

import { createTools, EXAMPLE_QUESTIONS } from "../../../src/agent/tools.ts";
import { MAX_QUERIES } from "../../../src/agent/validation.ts";
import { CATALOG, fakeMetrics } from "../../helpers/metrics.ts";

/** One run's tools, and a way to call one by name, as the agent loop does. */
function startRun() {
  const metrics = fakeMetrics();
  const tools = createTools(metrics);
  const call = (name: string, input: unknown) => {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `no tool named ${name}`);
    return tool.call(input);
  };
  return { metrics, tools, call };
}

const QUERY = { service: "checkout-api", metric: "errors", days: 3 };

test("every tool has a description, and arguments that convert to JSON Schema", () => {
  const { tools } = startRun();

  assert.deepEqual(
    tools.map((t) => t.name),
    ["list_services", "query_metrics", "create_chart", "clarify", "decline"],
  );
  for (const tool of tools) {
    assert.ok(tool.description.length > 80, `${tool.name} needs a description`);
    assert.equal(z.toJSONSchema(tool.args, { io: "input" }).type, "object");
  }
});

test("list_services returns the catalog, with or without empty arguments", async () => {
  const { call } = startRun();
  const expected = {
    done: false,
    result: CATALOG,
    step: "2 services, 2 metrics",
  };

  assert.deepEqual(await call("list_services", {}), expected);
  // Gemini leaves out the arguments of a call that has none.
  assert.deepEqual(await call("list_services", undefined), expected);
});

test("query_metrics keeps each result under an ID, and shows the model no points", async () => {
  const { call } = startRun();

  const first = await call("query_metrics", QUERY);
  const second = await call("query_metrics", {
    ...QUERY,
    service: "payments-service",
  });

  assert.deepEqual(first, {
    done: false,
    result: {
      id: "q1",
      service: "checkout-api",
      metric: "errors",
      unit: "count",
      days: 3,
      bucket: "day",
      points: 3,
      from: "2026-10-25T00:00:00.000Z",
      to: "2026-10-27T00:00:00.000Z",
      summary: { total: 109, avg: 1.85, min: 1, max: 4, latest: 2 },
    },
    step: "q1: 3 daily points",
  });
  assert.ok(!second.done);
  assert.equal(second.result.id, "q2");
});

test("query_metrics fills in the default range of 7 days", async () => {
  const { call, metrics } = startRun();

  await call("query_metrics", { service: "checkout-api", metric: "errors" });

  assert.equal(metrics.queries[0]?.days, 7);
});

test("query_metrics turns the metrics module's errors into tool errors", async () => {
  const { call } = startRun();

  await assert.rejects(
    call("query_metrics", { ...QUERY, service: "billing" }),
    {
      name: "ToolError",
      message: /Unknown service "billing"\. Known services: checkout-api/,
    },
  );
});

test("query_metrics refuses bad arguments without querying", async () => {
  const { call, metrics } = startRun();

  await assert.rejects(call("query_metrics", { ...QUERY, days: 31 }), {
    name: "ToolError",
    message: /Invalid query_metrics arguments:[\s\S]*at days/,
  });
  assert.equal(metrics.queries.length, 0);
});

test("a misspelled argument is an error the model can fix, never silently dropped", async () => {
  const { call, metrics } = startRun();

  // Dropped, "day" would leave the default of 7 days under a "30 days" title.
  await assert.rejects(
    call("query_metrics", {
      service: "checkout-api",
      metric: "errors",
      day: 30,
    }),
    { name: "ToolError", message: /Unrecognized key: "day"/ },
  );
  // Dropped, "aggregate" would turn a comparison into a chart over time.
  await assert.rejects(
    call("create_chart", {
      type: "bar",
      sources: ["q1"],
      title: "t",
      aggregate: "total",
    }),
    { name: "ToolError", message: /Unrecognized key: "aggregate"/ },
  );
  assert.equal(metrics.queries.length, 0);
});

test(`a question gets at most ${String(MAX_QUERIES)} queries`, async () => {
  const { call, metrics } = startRun();

  for (let i = 0; i < MAX_QUERIES; i++) await call("query_metrics", QUERY);

  await assert.rejects(call("query_metrics", QUERY), {
    name: "ToolError",
    message: /used its 10 queries\. Chart the results you have: q1, q2,/,
  });
  assert.equal(metrics.queries.length, MAX_QUERIES);
});

test("IDs follow the order of the calls, failed ones included", async () => {
  const { call } = startRun();

  // Wrong arguments, then an unknown service: each still takes its ID.
  await assert.rejects(call("query_metrics", { ...QUERY, days: 31 }), {
    name: "ToolError",
  });
  await assert.rejects(
    call("query_metrics", { ...QUERY, service: "billing" }),
    {
      name: "ToolError",
    },
  );
  const third = await call("query_metrics", QUERY);

  assert.ok(!third.done);
  assert.equal(third.result.id, "q3");
  // A chart in the same reply that counted on q1 is refused, instead of
  // drawing another service under its title.
  await assert.rejects(
    call("create_chart", { type: "line", sources: ["q1"], title: "t" }),
    { name: "ToolError", message: /Unknown result "q1"\. Known results: q3\./ },
  );
});

test("a wrong call rejects instead of throwing", async () => {
  const { tools } = startRun();

  for (const tool of tools) {
    // Throwing here, before there's a promise, would fail the test on the spot.
    const result = tool.call({ unexpected: true });
    await assert.rejects(result, { name: "ToolError" });
  }
});

test("create_chart draws from the run's own results, and ends the run", async () => {
  const { call } = startRun();
  await call("query_metrics", QUERY);
  await call("query_metrics", { ...QUERY, service: "payments-service" });

  const result = await call("create_chart", {
    type: "line",
    sources: ["q1", "q2"],
    title: "Errors per day, last 3 days",
  });

  assert.ok(result.done);
  assert.equal(result.step, "line chart: Errors per day, last 3 days");
  const outcome = Outcome.parse(result.outcome);
  assert.ok(outcome.outcome === "chart");
  assert.deepEqual(
    outcome.chart.series.map((s) => s.name),
    ["checkout-api", "payments-service"],
  );
});

test("create_chart checks its arguments' shape", async () => {
  const { call } = startRun();

  await assert.rejects(
    call("create_chart", { type: "scatter", sources: ["q1"], title: "t" }),
    {
      name: "ToolError",
      message: /Invalid create_chart arguments:[\s\S]*at type/,
    },
  );
  await assert.rejects(
    call("create_chart", { type: "line", sources: ["q1"], title: "   " }),
    {
      name: "ToolError",
      message: /Invalid create_chart arguments:[\s\S]*at title/,
    },
  );
});

test("each run has its own results", async () => {
  const first = startRun();
  const second = startRun();
  await first.call("query_metrics", QUERY);

  await assert.rejects(
    second.call("create_chart", { type: "line", sources: ["q1"], title: "t" }),
    { name: "ToolError", message: /Known results: none yet/ },
  );
});

test("clarify ends the run with the visitor's choices", async () => {
  const { call } = startRun();
  const choices = [
    "Show errors for checkout-api this week",
    "Show errors for payments-service this week",
  ];

  const result = await call("clarify", { message: "Which service?", choices });

  assert.deepEqual(result, {
    done: true,
    outcome: { outcome: "clarify", message: "Which service?", choices },
    step: "asked which one you meant",
  });
  Outcome.parse(result.outcome);
  await assert.rejects(
    call("clarify", { message: "Which?", choices: [choices[0]] }),
    { name: "ToolError", message: /Invalid clarify arguments/ },
  );
});

test("decline ends the run with the reason and the example questions", async () => {
  const { call } = startRun();

  const result = await call("decline", {
    reason: "I can only chart errors and latency.",
  });

  assert.deepEqual(result, {
    done: true,
    outcome: {
      outcome: "decline",
      message: "I can only chart errors and latency.",
      examples: EXAMPLE_QUESTIONS,
    },
    step: "declined",
  });
  Outcome.parse(result.outcome);
});
