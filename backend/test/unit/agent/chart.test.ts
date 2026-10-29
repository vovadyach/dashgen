import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChart } from "../../../src/agent/chart.ts";
import type { CreateChartArgs } from "../../../src/agent/types.ts";
import { errorsResult, latencyResult } from "../../helpers/results.ts";

// What query_metrics would have kept so far, by result ID.
const results = new Map([
  ["q1", errorsResult("checkout-api")],
  [
    "q2",
    errorsResult("payments-service", {
      summary: { total: 300, avg: 5.08, min: 0, max: 40, latest: 3 },
    }),
  ],
  ["q3", latencyResult("checkout-api", 417)],
  ["q4", latencyResult("payments-service", 120)],
  ["q5", errorsResult("auth-service", { days: 7 })],
  [
    "q6",
    errorsResult("search-service", {
      summary: { total: 0, avg: 0, min: 0, max: 0, latest: 0 },
    }),
  ],
  [
    "q7",
    errorsResult("notifications-worker", {
      summary: { total: 0, avg: 0, min: 0, max: 0, latest: 0 },
    }),
  ],
]);

test("a line chart has one series per service, with the real points", () => {
  const chart = buildChart(
    { type: "line", sources: ["q1"], title: "checkout-api errors per day" },
    results,
  );

  assert.deepEqual(chart, {
    type: "line",
    title: "checkout-api errors per day",
    unit: "count",
    x: "day",
    series: [
      {
        name: "checkout-api",
        points: [
          { x: "2026-10-25T00:00:00.000Z", y: 38 },
          { x: "2026-10-26T00:00:00.000Z", y: 55 },
          { x: "2026-10-27T00:00:00.000Z", y: 16, partial: true },
        ],
      },
    ],
  });
});

test("a bar chart compares services, with one number from each summary, named for what it is", () => {
  const chart = buildChart(
    {
      type: "bar",
      sources: ["q3", "q4"],
      title: "Average latency by service, last 3 days",
      aggregation: "avg",
    },
    results,
  );

  assert.equal(chart.x, "category");
  assert.equal(chart.unit, "ms");
  assert.deepEqual(chart.series, [
    {
      name: "latency_ms, hourly average",
      points: [
        { x: "checkout-api", y: 417 },
        { x: "payments-service", y: 120 },
      ],
    },
  ]);
});

test("a pie chart shows each service's share of the total", () => {
  const chart = buildChart(
    {
      type: "pie",
      sources: ["q1", "q2"],
      title: "Errors by service, last 3 days",
      aggregation: "total",
    },
    results,
  );

  assert.deepEqual(
    chart.series[0]?.points.map((p) => [p.x, p.y]),
    [
      ["checkout-api", 109],
      ["payments-service", 300],
    ],
  );
});

// Arguments of the wrong shape never get here: the create_chart tool checks them (tools.test.ts).
const refusals: [string, CreateChartArgs, RegExp][] = [
  [
    "an unknown result, listing the known ones",
    { type: "line", sources: ["q9"], title: "t" },
    /Unknown result "q9"\. Known results: q1, q2, q3, q4, q5, q6, q7\./,
  ],
  [
    "two metrics on one chart",
    { type: "line", sources: ["q1", "q4"], title: "t" },
    // Not "one chart per metric": create_chart ends the run, so a second one can't follow.
    /one metric, but these results have errors and latency_ms\. Chart one of them, or use clarify to ask the visitor which\./,
  ],
  [
    "the same service twice",
    { type: "line", sources: ["q1", "q1"], title: "t" },
    /checkout-api appears twice/,
  ],
  [
    "different time windows",
    { type: "bar", sources: ["q1", "q5"], title: "t", aggregation: "total" },
    /same days and bucket, but these cover 3 days by day and 7 days by day/,
  ],
  [
    "a pie chart over time",
    { type: "pie", sources: ["q1", "q2"], title: "t" },
    /needs 2 or more services and aggregation "total"/,
  ],
  [
    "a pie chart of hourly averages",
    { type: "pie", sources: ["q1", "q2"], title: "t", aggregation: "avg" },
    /needs 2 or more services and aggregation "total"/,
  ],
  [
    "a pie chart with one slice",
    { type: "pie", sources: ["q1"], title: "t", aggregation: "total" },
    /needs 2 or more services.*For one service over time, use a line chart without aggregation\./,
  ],
  [
    "a pie chart of latency, which has no total",
    { type: "pie", sources: ["q3", "q4"], title: "t", aggregation: "total" },
    /latency_ms averages, so it has no total\. Compare services with a bar chart and aggregation avg, max, min or latest\./,
  ],
  [
    // The same advice as with "total", so the model can't bounce between two refusals.
    "a pie chart of average latency",
    { type: "pie", sources: ["q3", "q4"], title: "t", aggregation: "avg" },
    /latency_ms averages, so it has no total\. Compare services with a bar chart/,
  ],
  [
    "a pie chart where every total is 0",
    { type: "pie", sources: ["q6", "q7"], title: "t", aggregation: "total" },
    /Every total is 0/,
  ],
  [
    // Said first, so adding "total" isn't refused next for the zeros.
    "a pie chart of zero totals, without aggregation",
    { type: "pie", sources: ["q6", "q7"], title: "t" },
    /Every total is 0, so there are no shares to show\. Use a bar chart\./,
  ],
  [
    "a line chart that compares services",
    { type: "line", sources: ["q1", "q2"], title: "t", aggregation: "max" },
    /line chart shows change over time: leave out aggregation, or compare services with a bar chart\./,
  ],
  [
    // In full, so the bar chart it suggests isn't refused for its total next.
    "a line chart of latency totals",
    { type: "line", sources: ["q3", "q4"], title: "t", aggregation: "total" },
    /compare services with a bar chart and aggregation avg, max, min or latest\./,
  ],
  [
    "a total of latencies",
    { type: "bar", sources: ["q3", "q4"], title: "t", aggregation: "total" },
    /latency_ms has no total/,
  ],
];

for (const [what, args, message] of refusals) {
  test(`refuses ${what}`, () => {
    assert.throws(() => buildChart(args, results), {
      name: "ToolError",
      message,
    });
  });
}

test("following a refusal's advice gives a chart, not another refusal", () => {
  // A pie of latency: a bar chart with aggregation avg, max, min or latest.
  const bar = buildChart(
    { type: "bar", sources: ["q3", "q4"], title: "t", aggregation: "avg" },
    results,
  );
  // A pie with one slice: a line chart without aggregation.
  const line = buildChart(
    { type: "line", sources: ["q1"], title: "t" },
    results,
  );
  // A pie of zero totals: a bar chart.
  const zeros = buildChart(
    { type: "bar", sources: ["q6", "q7"], title: "t", aggregation: "total" },
    results,
  );

  assert.equal(bar.type, "bar");
  assert.equal(line.type, "line");
  assert.equal(zeros.type, "bar");
});

test("before any query, says there are no results yet", () => {
  assert.throws(
    () => buildChart({ type: "line", sources: ["q1"], title: "t" }, new Map()),
    { name: "ToolError", message: /Known results: none yet\./ },
  );
});
