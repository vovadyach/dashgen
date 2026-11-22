import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { Chart } from "@dashgen/contracts";

import {
  CASES,
  type ChartExpectation,
  type EvalCase,
  type Expected,
  NOW,
} from "../../../evals/cases.ts";
import { gradeRun, rightChart } from "../../../evals/grade.ts";
import type { RunResult } from "../../../src/agent/index.ts";
import type { Aggregation, RunStep } from "../../../src/agent/types.ts";
import { createMetrics } from "../../../src/metrics/index.ts";
import { seedMetrics } from "../../../src/metrics/seed.ts";
import { createTestDb, type TestDb } from "../../helpers/db.ts";
import { findCase as find } from "../../helpers/evals.ts";

let testDb: TestDb | undefined;

before(async () => {
  testDb = await createTestDb();
  await seedMetrics(testDb.db, NOW);
});

after(() => testDb?.drop());

const metrics = () => {
  assert.ok(testDb);
  return createMetrics(testDb.db, { now: () => NOW });
};

const chartOf = (c: EvalCase): ChartExpectation => {
  assert.equal(c.expected.outcome, "chart");
  return c.expected.chart;
};

/** A finished run that ended this way, after a create_chart call with this aggregation. */
const run = (end: RunResult["end"], aggregation?: Aggregation): RunResult => {
  const steps: RunStep[] =
    end.type === "outcome" && end.outcome === "chart"
      ? [
          {
            type: "tool",
            tool: "create_chart",
            args: {
              type: end.chart.type,
              sources: ["q1"],
              title: end.chart.title,
              ...(aggregation ? { aggregation } : {}),
            },
            result: "a chart",
            ms: 1,
          },
        ]
      : [];
  return {
    end,
    steps,
    model: "fake",
    usage: { inputTokens: 0, outputTokens: 0 },
    ms: 1,
  };
};

const chartRun = (chart: Chart, aggregation?: Aggregation) =>
  run({ type: "outcome", outcome: "chart", chart }, aggregation);

/** The first right chart that DashGen can draw for the case, of its first type. */
async function firstRightChart(want: ChartExpectation): Promise<Chart> {
  for (const days of want.days) {
    for (const bucket of want.buckets) {
      const [type] = want.types;
      assert.ok(type);
      const chart = await rightChart(want, type, days, bucket, metrics());
      if (chart) return chart;
    }
  }
  assert.fail("no right chart can be drawn");
}

/** A right answer, as the agent would end its run. */
async function rightRun(expected: Expected): Promise<RunResult> {
  switch (expected.outcome) {
    case "chart":
      return chartRun(
        await firstRightChart(expected.chart),
        expected.chart.aggregation,
      );
    case "clarify":
      return run({
        type: "outcome",
        outcome: "clarify",
        message: "Which one did you mean?",
        choices: ["Errors?", "Latency?"],
      });
    case "decline":
      return run({
        type: "outcome",
        outcome: "decline",
        message: "DashGen can't help with that.",
        examples: [],
      });
  }
}

const ALL_RIGHT = { correct: 1, outcome: 1, chart: 1, data: 1 };
const ALL_WRONG = { correct: 0, outcome: 0, chart: 0, data: 0 };

describe("the eval cases", () => {
  it("have unique, path-safe ids", () => {
    const ids = CASES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  });
});

describe("gradeRun", () => {
  it("scores each case's right answers 1 on every metric, the others that are just as right too", async () => {
    for (const c of CASES) {
      for (const expected of [c.expected, ...(c.alsoRight ?? [])]) {
        const { grade } = await gradeRun(
          c,
          await rightRun(expected),
          metrics(),
        );
        assert.deepEqual(grade, ALL_RIGHT, c.id);
      }
    }
  });

  it("gives the main answer's reasons when a run matches none of the right answers", async () => {
    const c = find("c09");
    assert.ok(c.alsoRight?.length);
    const chart = await firstRightChart(chartOf(find("c01")));
    const { grade, explanation } = await gradeRun(
      c,
      chartRun(chart),
      metrics(),
    );
    assert.deepEqual(grade, ALL_WRONG);
    assert.equal(explanation.outcome, "Expected decline, got chart.");
  });

  it("scores a run that failed 0 on every metric, for every case", async () => {
    const failed = run({
      type: "error",
      code: "agent_failed",
      message: "DashGen couldn't answer that.",
    });
    for (const c of CASES) {
      const { grade, explanation } = await gradeRun(c, failed, metrics());
      assert.deepEqual(grade, ALL_WRONG, c.id);
      assert.match(explanation.outcome ?? "", /got error agent_failed/);
    }
  });

  it("scores a question back where a chart was expected as wrong", async () => {
    const c = find("c05");
    const { grade } = await gradeRun(
      c,
      run({
        type: "outcome",
        outcome: "clarify",
        message: "Of what?",
        choices: ["Errors?", "Latency?"],
      }),
      metrics(),
    );
    assert.deepEqual(grade, ALL_WRONG);
  });

  it("scores a chart over the wrong days as wrong data", async () => {
    const c = find("c01");
    const want = chartOf(c);
    const sixDays = await rightChart(want, "line", 6, "day", metrics());
    assert.ok(sixDays);
    const { grade } = await gradeRun(c, chartRun(sixDays), metrics());
    assert.deepEqual(grade, { correct: 0, outcome: 1, chart: 1, data: 0 });
  });

  it("scores a chart missing a service as a wrong chart", async () => {
    const c = find("c02");
    const want = chartOf(c);
    const fourServices = await rightChart(
      { ...want, services: want.services.slice(1) },
      "line",
      7,
      "day",
      metrics(),
    );
    assert.ok(fourServices);
    const { grade, explanation } = await gradeRun(
      c,
      chartRun(fourServices),
      metrics(),
    );
    assert.deepEqual(grade, { correct: 0, outcome: 1, chart: 0, data: 0 });
    assert.match(explanation.chart ?? "", /^Services /);
  });

  it("scores the right numbers drawn as the wrong type as a wrong chart, but right data", async () => {
    const c = find("c04");
    const want = chartOf(c);
    const bar = await rightChart(want, "bar", 7, "day", metrics());
    assert.ok(bar);
    const { grade } = await gradeRun(c, chartRun(bar, "total"), metrics());
    assert.deepEqual(grade, { correct: 0, outcome: 1, chart: 0, data: 1 });
  });

  it("scores the wrong aggregation as a wrong chart with wrong data", async () => {
    const c = find("c03");
    const want = chartOf(c);
    const highest = await rightChart(
      { ...want, aggregation: "max" },
      "bar",
      3,
      "day",
      metrics(),
    );
    assert.ok(highest);
    const { grade } = await gradeRun(c, chartRun(highest, "max"), metrics());
    assert.deepEqual(grade, { correct: 0, outcome: 1, chart: 0, data: 0 });
  });

  it("takes any of the days and buckets a case allows", async () => {
    const c = find("c13");
    const want = chartOf(c);
    const twoDaysHourly = await rightChart(want, "pie", 2, "hour", metrics());
    assert.ok(twoDaysHourly);
    const { grade } = await gradeRun(
      c,
      chartRun(twoDaysHourly, "total"),
      metrics(),
    );
    assert.deepEqual(grade, ALL_RIGHT);
  });

  it("gives a run that matches no right answer the marks of the closest one", async () => {
    // c02 takes a chart over time, or a bar of totals. This bar of totals
    // covers 6 days, not 7: the right chart choices, with the wrong data.
    const c = find("c02");
    const [totals] = c.alsoRight ?? [];
    assert.ok(totals?.outcome === "chart");
    const sixDays = await rightChart(totals.chart, "bar", 6, "day", metrics());
    assert.ok(sixDays);
    const { grade } = await gradeRun(c, chartRun(sixDays, "total"), metrics());
    assert.deepEqual(grade, { correct: 0, outcome: 1, chart: 1, data: 0 });
  });
});

describe("rightChart", () => {
  it("lets an error that isn't DashGen refusing the chart through, rather than call it wrong data", async () => {
    const broken = {
      listServices: () => Promise.reject(new Error("connection lost")),
      query: () => Promise.reject(new Error("connection lost")),
    };
    await assert.rejects(
      rightChart(chartOf(find("c01")), "line", 7, "day", broken),
      /connection lost/,
    );
  });
});
