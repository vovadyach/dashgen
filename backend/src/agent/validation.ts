import type { MetricsResult } from "@dashgen/contracts";
import { z } from "zod";

import { ToolError } from "./errors.ts";
import { distinct } from "./helpers.ts";
import type { CreateChartArgs, Message } from "./types.ts";

/** Every result is resent with each later model call, so a question gets this many. */
export const MAX_QUERIES = 10;

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

/** Refuses a query past the run's limit. `made` counts the queries started so far, failed ones too. */
export function checkQueryCount(made: number, ids: Iterable<string>): void {
  if (made >= MAX_QUERIES) {
    throw new ToolError(
      `This question has used its ${String(MAX_QUERIES)} queries. Chart the results you have: ${[...ids].join(", ") || "none"}.`,
    );
  }
}

/** The result for each ID, so a chart is drawn only from what this run fetched. */
export function findResults(
  ids: string[],
  results: ReadonlyMap<string, MetricsResult>,
): MetricsResult[] {
  return ids.map((id) => {
    const result = results.get(id);
    if (!result) {
      const known = [...results.keys()].join(", ") || "none yet";
      throw new ToolError(`Unknown result "${id}". Known results: ${known}.`);
    }
    return result;
  });
}

/**
 * The rules for drawing these results honestly as this chart. Each refusal
 * names a chart that would work, in full, so the model's next try succeeds
 * instead of trading one refusal for another.
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
        `A pie chart shows shares of a total, but ${averaged.metric} averages, so it has no total. Compare services with a bar chart and aggregation avg, max, min or latest.`,
      );
    }
    if (args.aggregation !== "total" || sources.length < 2) {
      throw new ToolError(
        'A pie chart shows each service\'s share of a total, so it needs 2 or more services and aggregation "total". For one service over time, use a line chart without aggregation.',
      );
    }
    if (sources.every((s) => s.summary.total === 0)) {
      throw new ToolError(
        "Every total is 0, so there are no shares to show. Use a bar chart.",
      );
    }
  }
  if (args.type === "line" && args.aggregation !== undefined) {
    // In full: a bar chart of an averaged metric can't take "total" either.
    const barAggregation =
      averaged && args.aggregation === "total"
        ? " and aggregation avg, max, min or latest"
        : "";
    throw new ToolError(
      `A line chart shows change over time: leave out aggregation, or compare services with a bar chart${barAggregation}.`,
    );
  }
  if (args.aggregation === "total" && averaged) {
    throw new ToolError(
      `${averaged.metric} has no total, since it averages. Use avg, max, min or latest.`,
    );
  }
}

/**
 * The rules every model's conversation follows, real or fake, so a loop that
 * breaks them fails in tests too. Breaking one is the caller's bug, not the
 * model's, so it's a plain Error.
 */
export function checkConversation(messages: Message[]): void {
  for (const message of messages) {
    if (message.role === "model" && message.reply.calls.length === 0) {
      throw new Error(
        `A reply without tool calls (${message.reply.finishReason}) can't go back in the conversation: send the request again instead.`,
      );
    }
    if (message.role === "tools" && message.outputs.length === 0) {
      throw new Error("A tools message needs at least one output.");
    }
  }
}
