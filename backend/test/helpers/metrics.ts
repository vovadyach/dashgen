import type { MetricsQuery } from "@dashgen/contracts";
import { DrizzleQueryError } from "drizzle-orm";

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

/**
 * The metrics module with its database down: every call fails as Drizzle
 * reports it, with the query's values in its message.
 */
export function downMetrics(): Metrics {
  const fail = () =>
    Promise.reject(
      new DrizzleQueryError(
        'select * from "points" where "service" = $1',
        ["payments-service"],
        new Error("connection refused"),
      ),
    );
  return { listServices: fail, query: fail };
}

/** The metrics module with a database that never answers. */
export function stalledMetrics(): Metrics {
  const never = () => new Promise<never>(() => undefined);
  return { listServices: never, query: never };
}
