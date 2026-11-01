import { DEFAULT_DAYS } from "@dashgen/contracts";

import type { Step } from "./run.ts";

const METRICS: Record<string, string> = {
  errors: "errors",
  latency_ms: "latency",
};

/**
 * A step in plain words, like "Fetched errors for payments-service over the
 * last 7 days". The page shows the tool's own name under it.
 */
export function describeStep(step: Step): string {
  const failed = "error" in step;
  const args: Record<string, unknown> =
    typeof step.args === "object" && step.args !== null
      ? (step.args as Record<string, unknown>)
      : {};
  switch (step.tool) {
    case "list_services":
      return failed
        ? "Tried to look up the services"
        : "Looked up the services and metrics";
    case "query_metrics": {
      const metric = text(args.metric) ?? "metrics";
      const service = text(args.service) ?? "a service";
      // The tool's default, when the model leaves days out.
      const days = typeof args.days === "number" ? args.days : DEFAULT_DAYS;
      const span =
        days === 1 ? "the last day" : `the last ${String(days)} days`;
      const what = `${METRICS[metric] ?? metric} for ${service} over ${span}`;
      return failed ? `Tried to fetch ${what}` : `Fetched ${what}`;
    }
    case "create_chart": {
      const type = text(args.type);
      const chart = type ? `a ${type} chart` : "the chart";
      return failed ? `Tried to draw ${chart}` : `Drew ${chart}`;
    }
    case "clarify":
      return "Asked which question you meant";
    case "decline":
      return "Explained what DashGen can answer";
    default:
      return step.tool;
  }
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
