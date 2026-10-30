import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
import { CHART, QUERY, QUESTION, REASON } from "../../fixtures/agent.ts";
import { recordingLogger } from "../../helpers/logger.ts";
import { downMetrics, fakeMetrics } from "../../helpers/metrics.ts";
import {
  blockedReply,
  busyError,
  declineReply,
  emptyReply,
  fakeModel,
  reply,
  type Step,
} from "../../helpers/model.ts";

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

describe("runAgent", () => {
  it("answers the design's example: the services, a query, then a chart built from it", async () => {
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

  it("runs a reply's calls in order, so a chart can use the queries before it in the same reply", async () => {
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

  it("ends with what the visitor sees after clarify or decline", async () => {
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

    const declined = await ask([declineReply()]);
    assert.deepEqual(declined.result.end, {
      type: "outcome",
      outcome: "decline",
      message: REASON,
      examples: EXAMPLE_QUESTIONS,
    });
  });

  it("fixes the clock at its start: the queries share it, and the instructions name its day", async () => {
    const times = [
      new Date("2026-10-29T23:59:59Z"),
      new Date("2026-10-30T00:00:01Z"),
    ];
    const clocks: (() => Date)[] = [];
    const { requests } = await ask([declineReply()], {
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

  describe("model mistakes", () => {
    it("sends a wrong call back to the model as an error it can correct", async () => {
      const { result, events, requests } = await ask([
        reply(
          ["query_metrics", { ...QUERY, service: "payments" }],
          ["draw_table"],
        ),
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

    it("sends the same request once more after a reply without a tool call, then fails", async () => {
      const recovered = await ask([emptyReply(), declineReply()]);
      assert.equal(outcomeOf(recovered.result).outcome, "decline");
      assert.deepEqual(
        recovered.requests[1]?.messages,
        recovered.requests[0]?.messages,
      );

      const failed = await ask([emptyReply(), emptyReply()]);
      assert.equal(errorOf(failed.result).code, "agent_failed");
      assert.equal(failed.requests.length, 2);
    });

    it("fails when a chart is refused twice", async () => {
      const unknownSource = () =>
        reply(["create_chart", { ...CHART, sources: ["q9"] }]);
      const { result, requests } = await ask([
        unknownSource(),
        unknownSource(),
      ]);

      assert.equal(errorOf(result).code, "agent_failed");
      assert.equal(requests.length, 2);
    });
  });

  describe("Gemini errors", () => {
    it("retries each request once, after a wait, when retrying can help", async () => {
      const recovered = await ask([
        busyError(),
        reply(["list_services"]),
        busyError(),
        declineReply(),
      ]);
      assert.equal(outcomeOf(recovered.result).outcome, "decline");
      assert.equal(recovered.waits, 2);

      const down = await ask([busyError(), busyError()]);
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

    it("ends at once when Gemini refuses the request, like a wrong key", async () => {
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

    it("declines a blocked question at once, since asking again gets the same block", async () => {
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

    it("gives a request one more try in all, whatever went wrong", async () => {
      const { result, requests } = await ask([busyError(), emptyReply()]);

      assert.equal(errorOf(result).code, "agent_failed");
      assert.equal(requests.length, 2);
    });
  });

  describe("limits", () => {
    it("makes at most 6 model calls", async () => {
      const { result, requests } = await ask(
        Array.from({ length: 6 }, () => reply(["list_services"])),
      );

      assert.equal(errorOf(result).code, "agent_failed");
      assert.equal(requests.length, RUN_LIMITS.modelCalls);
    });

    it("stops before a request that could take it past 24,000 input tokens", async () => {
      const big = (): ModelReply => ({
        ...reply(["list_services"]),
        usage: { inputTokens: 10_000, outputTokens: 60 },
      });
      const { result, requests } = await ask([big(), big(), big()]);

      assert.equal(errorOf(result).code, "agent_failed");
      // 20,000 used, and the next request would resend at least 10,000.
      assert.equal(requests.length, 2);
    });

    it("ends as a timeout at its deadline, even while it waits to retry", async () => {
      const hung = await ask(["hang"], { timeoutMs: 20 });
      assert.equal(errorOf(hung.result).code, "timeout");

      const waiting = await ask([busyError()], {
        timeoutMs: 20,
        retryDelayMs: () => 60_000,
      });
      assert.equal(errorOf(waiting.result).code, "timeout");
    });
  });

  describe("unexpected errors", () => {
    it("ends as unavailable when a tool fails in a way the model can't fix, like the database", async () => {
      const { result, events, lines } = await ask([reply(["list_services"])], {
        metrics: downMetrics,
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

    it("rejects when DashGen has a bug, instead of hiding it in an error event", async () => {
      await assert.rejects(ask([new Error("a bug")]), /a bug/);
    });
  });
});
