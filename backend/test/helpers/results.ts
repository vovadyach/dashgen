import type { MetricsResult } from "@dashgen/contracts";

/** A 3-day errors result, shaped like the design's example, for tests with no database. */
export const errorsResult = (
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

/** The same window for latency, which averages, so it has no total. */
export const latencyResult = (service: string, avg: number): MetricsResult => ({
  ...errorsResult(service),
  metric: "latency_ms",
  unit: "ms",
  summary: { avg, min: avg / 2, max: avg * 2, latest: avg },
});
