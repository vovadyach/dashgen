import { createTools } from "../../src/agent/tools.ts";
import type { Message } from "../../src/agent/types.ts";

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

// For the adapters, only the tools' names, descriptions and schemas matter.
const unused = () => Promise.reject(new Error("not called in these tests"));
export const TOOLS = createTools({ listServices: unused, query: unused });

export const QUESTION_MESSAGE: Extract<Message, { role: "user" }> = {
  role: "user",
  text: QUESTION,
};
