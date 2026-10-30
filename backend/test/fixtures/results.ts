import { errorsResult, latencyResult } from "../helpers/results.ts";

// What query_metrics would have kept so far in a run, by result ID.
export const RESULTS = new Map([
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
