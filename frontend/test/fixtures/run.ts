import {
  type Chart,
  MAX_POINTS,
  MAX_SERIES,
  type RunEvent,
} from "@dashgen/contracts";

export const QUESTION = "Show errors for payments-service this week";
export const RUN_ID = "019a3b2c-5d00-7000-8000-000000000001";
export const SECOND_RUN_ID = "019a3b2c-5d00-7000-8000-000000000002";

/** The design's example: the services, a query, then the chart. */
export const STEPS = [
  {
    type: "step",
    tool: "list_services",
    args: {},
    result: "5 services, 2 metrics",
    ms: 15,
  },
  {
    type: "step",
    tool: "query_metrics",
    args: { service: "payments-service", metric: "errors", days: 7 },
    result: "q1: 7 daily points",
    ms: 9,
  },
  {
    type: "step",
    tool: "create_chart",
    args: { sources: ["q1"], type: "line", title: "Errors" },
    result: "line chart: Errors for payments-service, last 7 days",
    ms: 0,
  },
] as const satisfies RunEvent[];

/** A tool call the backend refused, which goes back to the model to fix. */
export const FAILED_STEP = {
  type: "step",
  tool: "create_chart",
  args: { sources: ["q2"], type: "line", title: "Errors" },
  error: 'Unknown result "q2". Known results: q1.',
  ms: 1,
} as const satisfies RunEvent;

/** A week of daily errors, ending with today so far. */
export const CHART: Chart = {
  type: "line",
  title: "Errors for payments-service, last 7 days",
  unit: "count",
  x: "day",
  series: [
    {
      name: "payments-service",
      points: [
        { x: "2026-10-25T00:00:00.000Z", y: 26 },
        { x: "2026-10-26T00:00:00.000Z", y: 36 },
        { x: "2026-10-27T00:00:00.000Z", y: 35 },
        { x: "2026-10-28T00:00:00.000Z", y: 39 },
        { x: "2026-10-29T00:00:00.000Z", y: 94 },
        { x: "2026-10-30T00:00:00.000Z", y: 32 },
        { x: "2026-10-31T00:00:00.000Z", y: 28, partial: true },
      ],
    },
  ],
};

/** Each hour of 30 days, the longest span a chart covers. */
export const HOURS = Array.from({ length: MAX_POINTS }, (_, i) =>
  new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
);

/**
 * Ten services by the hour over 30 days, each number different, so it
 * can't pack into a link short enough to open.
 */
export const TOO_LARGE_FOR_A_LINK: Chart = {
  type: "line",
  title: "Latency for ten services, by the hour",
  unit: "ms",
  x: "hour",
  series: Array.from({ length: MAX_SERIES }, (_, s) => ({
    name: `service-${String(s + 1)}`,
    points: HOURS.map((x, i) => ({
      x,
      y: ((i * 7919 + s * 104_729) % 100_003) / 7,
    })),
  })),
};

export const CHART_OUTCOME = {
  type: "outcome",
  outcome: "chart",
  chart: CHART,
} as const satisfies RunEvent;

export const CLARIFY = {
  type: "outcome",
  outcome: "clarify",
  message: "Which metric do you mean?",
  choices: [
    "Show errors for checkout-api this week",
    "Show latency for checkout-api this week",
  ],
} as const satisfies RunEvent;

export const DECLINE = {
  type: "outcome",
  outcome: "decline",
  message: "DashGen only knows errors and latency.",
  examples: ["Which service had the most errors this week?"],
} as const satisfies RunEvent;

export const TIMEOUT = {
  type: "error",
  code: "timeout",
  message: "That took too long. Try again.",
} as const satisfies RunEvent;
