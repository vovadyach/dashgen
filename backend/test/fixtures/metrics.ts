// The design's example question is asked at 10:00 UTC.
export const NOW = new Date("2026-10-27T10:00:00Z");

// The services and metrics that fakeMetrics knows.
export const CATALOG = {
  services: ["checkout-api", "payments-service"],
  metrics: [
    { name: "errors", unit: "count", rollup: "sum" as const },
    { name: "latency_ms", unit: "ms", rollup: "avg" as const },
  ],
};
