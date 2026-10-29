import type { MetricsQuery } from "@dashgen/contracts";

import { type Metrics, MetricsError } from "../../src/metrics/index.ts";
import { errorsResult } from "./results.ts";

export const CATALOG = {
  services: ["checkout-api", "payments-service"],
  metrics: [
    { name: "errors", unit: "count", rollup: "sum" as const },
    { name: "latency_ms", unit: "ms", rollup: "avg" as const },
  ],
};

/** The metrics module without a database: a known service gets the sample result. */
export function fakeMetrics(): Metrics & { queries: MetricsQuery[] } {
  const queries: MetricsQuery[] = [];
  return {
    queries,
    listServices: () => Promise.resolve(CATALOG),
    query: (input) => {
      queries.push(input);
      if (!CATALOG.services.includes(input.service)) {
        return Promise.reject(
          new MetricsError(
            `Unknown service "${input.service}". Known services: ${CATALOG.services.join(", ")}.`,
          ),
        );
      }
      return Promise.resolve(errorsResult(input.service));
    },
  };
}
