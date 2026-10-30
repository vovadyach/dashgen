// A question, a query for it, and a chart of that query's result (q1).
export const QUESTION = "Show errors for payments-service this week";
export const QUERY = { service: "payments-service", metric: "errors", days: 3 };
export const CHART = {
  type: "line",
  sources: ["q1"],
  title: "Errors per day, payments-service, last 3 days",
};

// The same query for checkout-api.
export const CHECKOUT_QUERY = {
  service: "checkout-api",
  metric: "errors",
  days: 3,
};

// The reason a decline call gives.
export const REASON = "DashGen only charts these services' errors and latency.";
