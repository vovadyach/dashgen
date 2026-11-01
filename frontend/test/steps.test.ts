import { describe, expect, it } from "vitest";

import type { Step } from "../src/run.ts";
import { describeStep } from "../src/steps.ts";
import { FAILED_STEP, STEPS } from "./fixtures/run.ts";

const query = (args: unknown): Step => ({
  type: "step",
  tool: "query_metrics",
  args,
  result: "q1: 7 daily points",
  ms: 9,
});

describe("describeStep", () => {
  it("puts each tool call in plain words", () => {
    expect(STEPS.map(describeStep)).toEqual([
      "Looked up the services and metrics",
      "Fetched errors for payments-service over the last 7 days",
      "Drew a line chart",
    ]);
  });

  it("says what a failed call tried to do", () => {
    expect(describeStep(FAILED_STEP)).toBe("Tried to draw a line chart");
  });

  it.each([
    [
      { service: "auth-service", metric: "latency_ms", days: 1 },
      "Fetched latency for auth-service over the last day",
    ],
    [
      { service: "auth-service", metric: "errors" },
      "Fetched errors for auth-service over the last 7 days",
    ],
    ["not an object", "Fetched metrics for a service over the last 7 days"],
  ])("names a query's metric, service and days, from %j", (args, words) => {
    expect(describeStep(query(args))).toBe(words);
  });

  it("falls back to the tool's own name for a tool it doesn't know", () => {
    expect(describeStep({ ...query({}), tool: "new_tool" })).toBe("new_tool");
  });
});
