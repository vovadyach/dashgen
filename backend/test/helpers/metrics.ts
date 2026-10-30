import type { MetricsQuery } from "@dashgen/contracts";

import { type Metrics, MetricsError } from "../../src/metrics/index.ts";
import { CATALOG } from "../fixtures/metrics.ts";
import { errorsResult } from "./results.ts";

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

/** The metrics module with its database down: every call fails. */
export function downMetrics(): Metrics {
  return {
    listServices: () => Promise.reject(new Error("connection refused")),
    query: () => Promise.reject(new Error("connection refused")),
  };
}
