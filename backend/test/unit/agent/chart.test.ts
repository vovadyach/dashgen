import assert from "node:assert/strict";
import { test } from "node:test";

import type { MetricsResult } from "@dashgen/contracts";

import { buildChart } from "../../../src/agent/chart.ts";

const errors = (
  service: string,
  overrides: Partial<MetricsResult> = {},
): MetricsResult => ({
  service,
  metric: "errors",
  unit: "count",
  days: 3,
  bucket: "day",
  points: [
    { t: "2026-10-25T00:00:00.000Z", value: 38 },
    { t: "2026-10-26T00:00:00.000Z", value: 55 },
    { t: "2026-10-27T00:00:00.000Z", value: 16, partial: true },
  ],
  summary: { total: 109, avg: 1.85, min: 1, max: 4, latest: 2 },
  ...overrides,
});

const latency = (service: string, avg: number): MetricsResult => ({
  ...errors(service),
  metric: "latency_ms",
  unit: "ms",
  summary: { avg, min: avg / 2, max: avg * 2, latest: avg },
});

// What query_metrics would have kept so far, by result ID.
const results = new Map([
  ["q1", errors("checkout-api")],
  [
    "q2",
    errors("payments-service", {
      summary: { total: 300, avg: 5.08, min: 0, max: 40, latest: 3 },
    }),
  ],
  ["q3", latency("checkout-api", 417)],
  ["q4", latency("payments-service", 120)],
  ["q5", errors("auth-service", { days: 7 })],
  [
    "q6",
    errors("search-service", {
      summary: { total: 0, avg: 0, min: 0, max: 0, latest: 0 },
    }),
  ],
  [
    "q7",
    errors("notifications-worker", {
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

const refusals: [string, unknown, RegExp][] = [
  [
    "a chart type it doesn't know",
    { type: "scatter", sources: ["q1"], title: "t" },
    /Invalid create_chart arguments:[\s\S]*at type/,
  ],
  [
    "a blank title",
    { type: "line", sources: ["q1"], title: "   " },
    /Invalid create_chart arguments:[\s\S]*at title/,
  ],
  [
    "an unknown result, listing the known ones",
    { type: "line", sources: ["q9"], title: "t" },
    /Unknown result "q9"\. Known results: q1, q2, q3, q4, q5, q6, q7\./,
  ],
  [
    "two metrics on one chart",
    { type: "line", sources: ["q1", "q4"], title: "t" },
    /one metric, but these results have errors and latency_ms/,
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
    /needs 2 or more services.*For one service over time, use a line chart/,
  ],
  [
    "a pie chart of latency, which has no total",
    { type: "pie", sources: ["q3", "q4"], title: "t", aggregation: "total" },
    /latency_ms averages, so it has no total\. Compare services with a bar chart/,
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
    "a line chart that compares services",
    { type: "line", sources: ["q1", "q2"], title: "t", aggregation: "max" },
    /line chart shows change over time/,
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

test("before any query, says there are no results yet", () => {
  assert.throws(
    () => buildChart({ type: "line", sources: ["q1"], title: "t" }, new Map()),
    { name: "ToolError", message: /Known results: none yet\./ },
  );
});
