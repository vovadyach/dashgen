import type { MetricsResult } from "@dashgen/contracts";
import { z } from "zod";

import { ToolError } from "./errors.ts";
import { distinct } from "./helpers.ts";
import type { CreateChartArgs } from "./types.ts";

/** Checks a tool's arguments from the model. A bad one is a ToolError it can correct, not a crash. */
export function parseArgs<T extends z.ZodType>(
  tool: string,
  schema: T,
  input: unknown,
): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ToolError(
      `Invalid ${tool} arguments:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

/**
 * The rules for drawing these results honestly as this chart. Each refusal
 * names a chart that would work, so the model's next try succeeds instead of
 * trading one refusal for another.
 */
export function checkChart(
  args: CreateChartArgs,
  sources: MetricsResult[],
): void {
  const metrics = distinct(sources.map((s) => s.metric));
  if (metrics.length > 1) {
    throw new ToolError(
      `A chart shows one metric, but these results have ${metrics.join(" and ")}. Make one chart per metric.`,
    );
  }
  const services = sources.map((s) => s.service);
  const repeated = services.find((s, i) => services.indexOf(s) !== i);
  if (repeated !== undefined) {
    throw new ToolError(
      `Each result must be a different service, but ${repeated} appears twice.`,
    );
  }
  // Side by side, a 7-day average next to a 30-day one would mislead.
  const windows = distinct(
    sources.map((s) => `${String(s.days)} days by ${s.bucket}`),
  );
  if (windows.length > 1) {
    throw new ToolError(
      `Results on one chart need the same days and bucket, but these cover ${windows.join(" and ")}. Query them again the same way.`,
    );
  }

  // Metrics that average, like latency, have no total.
  const averaged = sources.find((s) => s.summary.total === undefined);
  if (args.type === "pie") {
    if (averaged) {
      throw new ToolError(
        `A pie chart shows shares of a total, but ${averaged.metric} averages, so it has no total. Compare services with a bar chart.`,
      );
    }
    if (args.aggregation !== "total" || sources.length < 2) {
      throw new ToolError(
        'A pie chart shows each service\'s share of a total, so it needs 2 or more services and aggregation "total". For one service over time, use a line chart.',
      );
    }
    if (sources.every((s) => s.summary.total === 0)) {
      throw new ToolError(
        "Every total is 0, so there are no shares to show. Use a bar chart.",
      );
    }
  }
  if (args.type === "line" && args.aggregation !== undefined) {
    throw new ToolError(
      "A line chart shows change over time: leave out aggregation, or compare services with a bar chart.",
    );
  }
  if (args.aggregation === "total" && averaged) {
    throw new ToolError(
      `${averaged.metric} has no total, since it averages. Use avg, max, min or latest.`,
    );
  }
}
