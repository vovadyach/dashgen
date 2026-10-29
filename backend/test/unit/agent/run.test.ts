import assert from "node:assert/strict";
import { test } from "node:test";

import { ModelError } from "../../../src/agent/errors.ts";
import {
  RUN_LIMITS,
  type RunOptions,
  runAgent,
} from "../../../src/agent/run.ts";
import { EXAMPLE_QUESTIONS } from "../../../src/agent/tools.ts";
import type {
  ModelReply,
  RunEvent,
  RunResult,
} from "../../../src/agent/types.ts";
import type { Metrics } from "../../../src/metrics/index.ts";
import { recordingLogger } from "../../helpers/logger.ts";
import { fakeMetrics } from "../../helpers/metrics.ts";
import {
  blockedReply,
  emptyReply,
  fakeModel,
  reply,
  type Step,
} from "../../helpers/model.ts";

const QUESTION = "Show errors for payments-service this week";
const QUERY = { service: "payments-service", metric: "errors", days: 3 };
const CHART = {
  type: "line",
  sources: ["q1"],
  title: "Errors per day, payments-service, last 3 days",
};
const REASON = "DashGen only charts these services' errors and latency.";

const decline = () => reply(["decline", { reason: REASON }]);
const busy = () =>
  new ModelError("Gemini answered 503: overloaded", {
    retryable: true,
    status: 503,
  });

/** Asks QUESTION of a scripted model, with no waits, and keeps every event and log line. */
async function ask(script: Step[], options: Partial<RunOptions> = {}) {
  const model = fakeModel(script);
  const events: RunEvent[] = [];
  const { log, lines } = recordingLogger();
  let waits = 0;
  const result = await runAgent(QUESTION, {
    model,
    metrics: () => fakeMetrics(),
    log,
    onEvent: (event) => {
      events.push(event);
    },
    retryDelayMs: () => {
      waits += 1;
      return 0;
    },
    ...options,
  });
  return { result, events, lines, requests: model.requests, waits };
}

function outcomeOf(result: RunResult) {
  const { end } = result;
  assert.ok(end.type === "outcome", `the run ended with ${end.type}`);
  return end;
}

function errorOf(result: RunResult) {
  const { end } = result;
  assert.ok(end.type === "error", `the run ended with ${end.type}`);
  return end;
}

/** Each step event as one line: the tool, then its result or error. */
const stepLines = (events: RunEvent[]) =>
  events.flatMap((e) =>
    e.type === "step"
      ? [`${e.tool}: ${"result" in e ? e.result : e.error}`]
      : [],
  );

test("the design's example: the services, a query, then a chart built from it", async () => {
  const { result, events, requests } = await ask([
    reply(["list_services"]),
    reply(["query_metrics", QUERY]),
    reply(["create_chart", CHART]),
  ]);

  const end = outcomeOf(result);
  assert.ok(end.outcome === "chart");
  assert.equal(end.chart.title, CHART.title);
  assert.deepEqual(
    end.chart.series.map((s) => s.name),
    ["payments-service"],
  );
  assert.deepEqual(stepLines(events), [
    "list_services: 2 services, 2 metrics",
    "query_metrics: q1: 3 daily points",
    `create_chart: line chart: ${CHART.title}`,
  ]);
  assert.deepEqual(events.at(-1), end);
  // Each request resends the conversation: the question, then each reply and its tools' outputs.
  assert.deepEqual(
    requests.map((r) => r.messages.length),
    [1, 3, 5],
  );
  // What the runs table keeps.
  assert.deepEqual(
    result.steps.map((s) => s.type),
    ["model", "tool", "model", "tool", "model", "tool"],
  );
  assert.deepEqual(result.usage, { inputTokens: 6_000, outputTokens: 180 });
  assert.equal(result.model, "fake-model");
});

test("a reply's calls run in order, so a chart can use the queries before it in the same reply", async () => {
  const { result, requests } = await ask([
    reply(
      ["query_metrics", { ...QUERY, service: "checkout-api" }],
      ["query_metrics", QUERY],
      [
        "create_chart",
        {
          type: "bar",
          sources: ["q1", "q2"],
          title: "Errors by service, last 3 days",
          aggregation: "total",
        },
      ],
    ),
  ]);

  const end = outcomeOf(result);
  assert.ok(end.outcome === "chart");
  assert.deepEqual(
    end.chart.series[0]?.points.map((p) => p.x),
    ["checkout-api", "payments-service"],
  );
  assert.equal(requests.length, 1);
});

test("clarify and decline end the run with what the visitor sees", async () => {
  const choices = [
    "Show errors for checkout-api this week",
    "Show errors for payments-service this week",
  ];
  const clarified = await ask([
    reply(["clarify", { message: "Which service?", choices }]),
  ]);
  assert.deepEqual(clarified.result.end, {
    type: "outcome",
    outcome: "clarify",
    message: "Which service?",
    choices,
  });

  const declined = await ask([decline()]);
  assert.deepEqual(declined.result.end, {
    type: "outcome",
    outcome: "decline",
    message: REASON,
    examples: EXAMPLE_QUESTIONS,
  });
});

test("a wrong call goes back to the model as an error it can correct", async () => {
  const { result, events, requests } = await ask([
    reply(["query_metrics", { ...QUERY, service: "payments" }], ["draw_table"]),
    reply(["query_metrics", QUERY]),
    // The failed query took q1.
    reply(["create_chart", { ...CHART, sources: ["q2"] }]),
  ]);

  assert.equal(outcomeOf(result).outcome, "chart");
  const sent = requests[1]?.messages.at(-1);
  assert.ok(sent?.role === "tools");
  assert.deepEqual(
    sent.outputs.map((o) => ("error" in o ? o.error : "no error")),
    [
      'Unknown service "payments". Known services: checkout-api, payments-service.',
      'Unknown tool "draw_table". Use one of: list_services, query_metrics, create_chart, clarify, decline.',
    ],
  );
  assert.equal(
    stepLines(events)[0],
    'query_metrics: Unknown service "payments". Known services: checkout-api, payments-service.',
  );
});

test("Gemini failing in a way retrying can fix gets one retry per request, after a wait", async () => {
  const recovered = await ask([
    busy(),
    reply(["list_services"]),
    busy(),
    decline(),
  ]);
  assert.equal(outcomeOf(recovered.result).outcome, "decline");
  assert.equal(recovered.waits, 2);

  const down = await ask([busy(), busy()]);
  const end = errorOf(down.result);
  assert.equal(end.code, "unavailable");
  assert.equal(
    end.message,
    "Gemini can't answer right now. Try again in a moment.",
  );
  assert.equal(down.requests.length, 2);
  assert.ok(
    down.lines.some(
      (l) => l.level === "warn" && l.msg === "model call failed, retrying",
    ),
  );
});

test("Gemini refusing the request, like a wrong key, ends the run at once", async () => {
  const { result, requests, waits } = await ask([
    new ModelError("Gemini answered 400: API key not valid", {
      retryable: false,
      status: 400,
    }),
  ]);

  assert.equal(errorOf(result).code, "unavailable");
  assert.equal(requests.length, 1);
  assert.equal(waits, 0);
});

test("a blocked question ends as a decline at once, since asking again gets the same block", async () => {
  const { result, requests } = await ask([blockedReply()]);

  assert.deepEqual(result.end, {
    type: "outcome",
    outcome: "decline",
    message:
      "DashGen can't help with that. It charts the errors and latency of a few sample services.",
    examples: EXAMPLE_QUESTIONS,
  });
  assert.equal(requests.length, 1);
});

test("a reply without a tool call gets the same request once more, then the run fails", async () => {
  const recovered = await ask([emptyReply(), decline()]);
  assert.equal(outcomeOf(recovered.result).outcome, "decline");
  assert.deepEqual(
    recovered.requests[1]?.messages,
    recovered.requests[0]?.messages,
  );

  const failed = await ask([emptyReply(), emptyReply()]);
  assert.equal(errorOf(failed.result).code, "agent_failed");
  assert.equal(failed.requests.length, 2);
});

test("a request gets one more try in all, whatever went wrong", async () => {
  const { result, requests } = await ask([busy(), emptyReply()]);

  assert.equal(errorOf(result).code, "agent_failed");
  assert.equal(requests.length, 2);
});

test("a run makes at most 6 model calls", async () => {
  const { result, requests } = await ask(
    Array.from({ length: 6 }, () => reply(["list_services"])),
  );

  assert.equal(errorOf(result).code, "agent_failed");
  assert.equal(requests.length, RUN_LIMITS.modelCalls);
});

test("a run stops before a request that could take it past 24,000 input tokens", async () => {
  const big = (): ModelReply => ({
    ...reply(["list_services"]),
    usage: { inputTokens: 10_000, outputTokens: 60 },
  });
  const { result, requests } = await ask([big(), big(), big()]);

  assert.equal(errorOf(result).code, "agent_failed");
  // 20,000 used, and the next request would resend at least 10,000.
  assert.equal(requests.length, 2);
});

test("the run's deadline ends it as a timeout, even while it waits to retry", async () => {
  const hung = await ask(["hang"], { timeoutMs: 20 });
  assert.equal(errorOf(hung.result).code, "timeout");

  const waiting = await ask([busy()], {
    timeoutMs: 20,
    retryDelayMs: () => 60_000,
  });
  assert.equal(errorOf(waiting.result).code, "timeout");
});

test("a chart refused twice ends the run", async () => {
  const unknownSource = () =>
    reply(["create_chart", { ...CHART, sources: ["q9"] }]);
  const { result, requests } = await ask([unknownSource(), unknownSource()]);

  assert.equal(errorOf(result).code, "agent_failed");
  assert.equal(requests.length, 2);
});

test("a tool failing for another reason, like the database, ends the run as unavailable", async () => {
  const down: Metrics = {
    listServices: () => Promise.reject(new Error("connection refused")),
    query: () => Promise.reject(new Error("connection refused")),
  };
  const { result, events, lines } = await ask([reply(["list_services"])], {
    metrics: () => down,
  });

  const end = errorOf(result);
  assert.equal(end.code, "unavailable");
  assert.equal(
    end.message,
    "The metrics are unavailable right now. Try again in a moment.",
  );
  assert.deepEqual(stepLines(events), ["list_services: failed"]);
  // The real reason is logged once, and visitors never see it.
  assert.deepEqual(
    lines.filter((l) => l.level === "error").map((l) => l.msg),
    ["run failed"],
  );
});

test("a bug in DashGen rejects, instead of hiding in an error event", async () => {
  await assert.rejects(ask([new Error("a bug")]), /a bug/);
});

test("a run's queries share the clock fixed at its start, and the instructions name that day", async () => {
  const times = [
    new Date("2026-10-29T23:59:59Z"),
    new Date("2026-10-30T00:00:01Z"),
  ];
  const clocks: (() => Date)[] = [];
  const { requests } = await ask([decline()], {
    now: () => times.shift() ?? new Date(),
    metrics: (now) => {
      clocks.push(now);
      return fakeMetrics();
    },
  });

  // Still the start, though the real clock has moved past midnight.
  assert.equal(clocks[0]?.().toISOString(), "2026-10-29T23:59:59.000Z");
  assert.match(
    requests[0]?.system ?? "",
    /Today is Thursday, 2026-10-29, in UTC\./,
  );
});
