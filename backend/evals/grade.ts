// Grades one run of an eval case, by code alone: did it end the right way,
// draw the right chart, and show the right numbers (cases.md, "How it's graded").
import type { Bucket, Chart, MetricsResult } from "@dashgen/contracts";

import { buildChart } from "../src/agent/chart.ts";
import { ToolError } from "../src/agent/errors.ts";
import type { RunResult } from "../src/agent/index.ts";
import { CreateChartArgs } from "../src/agent/types.ts";
import { type Metrics, MetricsError } from "../src/metrics/index.ts";
import type { ChartExpectation, EvalCase, Expected } from "./cases.ts";

/** Each metric is 1 or 0. `correct` is the headline: all 3 others. */
export const METRIC_IDS = ["correct", "outcome", "chart", "data"] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export interface Graded {
  grade: Record<MetricId, 0 | 1>;
  /** Why each failed metric failed. */
  explanation: Partial<Record<MetricId, string>>;
}

const UNITS: Record<ChartExpectation["metric"], string> = {
  errors: "count",
  latency_ms: "ms",
};

/** How the run ended, in a word: "chart", "clarify", "decline", or the error's code. */
export function endOf(result: RunResult): string {
  return result.end.type === "outcome"
    ? result.end.outcome
    : `error ${result.end.code}`;
}

/**
 * Grades the run against the case's right answer, and against each of the
 * others that are just as right: the first that it matches wins. When it
 * matches none, the grade and its reasons are those of the closest one, with
 * the most marks, and of the main one on a tie.
 */
export async function gradeRun(
  evalCase: EvalCase,
  result: RunResult,
  metrics: Metrics,
): Promise<Graded> {
  const main = await gradeAgainst(evalCase.expected, result, metrics);
  if (main.grade.correct) return main;
  let closest = main;
  for (const expected of evalCase.alsoRight ?? []) {
    const graded = await gradeAgainst(expected, result, metrics);
    if (graded.grade.correct) return graded;
    if (marks(graded) > marks(closest)) closest = graded;
  }
  return closest;
}

const marks = ({ grade }: Graded) => grade.outcome + grade.chart + grade.data;

async function gradeAgainst(
  expected: Expected,
  result: RunResult,
  metrics: Metrics,
): Promise<Graded> {
  const ended = endOf(result);
  const outcome = ended === expected.outcome ? 1 : 0;
  const explanation: Graded["explanation"] = {};
  if (!outcome) {
    explanation.outcome = `Expected ${expected.outcome}, got ${ended}.`;
  }

  // A question back or a refusal has nothing more to check.
  if (expected.outcome !== "chart") {
    return {
      grade: { correct: outcome, outcome, chart: outcome, data: outcome },
      explanation,
    };
  }
  if (result.end.type !== "outcome" || result.end.outcome !== "chart") {
    return {
      grade: { correct: 0, outcome: 0, chart: 0, data: 0 },
      explanation,
    };
  }

  const { chart } = result.end;
  const want = expected.chart;
  const problems = chartProblems(chart, aggregationOf(result), want);
  const chartRight = problems.length === 0 ? 1 : 0;
  if (!chartRight) explanation.chart = problems.join(" ");

  const data = (await hasRightData(chart, want, metrics)) ? 1 : 0;
  if (!data) {
    explanation.data =
      "Its values, dates or units match no right chart: not for any of the expected days and buckets.";
  }

  const correct = chartRight && data ? 1 : 0;
  return { grade: { correct, outcome, chart: chartRight, data }, explanation };
}

/** What's wrong with the chart's choices: its type, metric, aggregation and services. */
function chartProblems(
  chart: Chart,
  aggregation: string | undefined,
  want: ChartExpectation,
): string[] {
  const problems: string[] = [];
  if (!want.types.includes(chart.type)) {
    problems.push(
      `A ${chart.type} chart, not a ${want.types.join(" or ")} chart.`,
    );
  }
  if (chart.unit !== UNITS[want.metric]) {
    problems.push(`In ${chart.unit}, not ${UNITS[want.metric]}.`);
  }
  if (aggregation !== want.aggregation) {
    problems.push(
      `Aggregation ${aggregation ?? "none"}, not ${want.aggregation ?? "none"}.`,
    );
  }
  const services = servicesOf(chart);
  if (!sameSet(services, want.services)) {
    problems.push(
      `Services ${services.join(", ")}, not ${want.services.join(", ")}.`,
    );
  }
  return problems;
}

/** The services a chart shows: a series each over time, or a category each when it compares them. */
function servicesOf(chart: Chart): string[] {
  return chart.x === "category"
    ? (chart.series[0]?.points.map((p) => p.x) ?? [])
    : chart.series.map((s) => s.name);
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** The aggregation of the run's last create_chart call that worked. */
function aggregationOf(result: RunResult): string | undefined {
  for (const step of [...result.steps].reverse()) {
    if (
      step.type === "tool" &&
      step.tool === "create_chart" &&
      !("error" in step)
    ) {
      const args = CreateChartArgs.safeParse(step.args);
      return args.success ? args.data.aggregation : undefined;
    }
  }
  return undefined;
}

/**
 * Whether the chart's values, dates and units are those of a right chart:
 * the expected services' data, for one of the expected days and buckets,
 * built by DashGen's own chart code. The title is the model's own words, so
 * it isn't compared.
 */
async function hasRightData(
  chart: Chart,
  want: ChartExpectation,
  metrics: Metrics,
): Promise<boolean> {
  const got = comparable(chart);
  for (const days of want.days) {
    for (const bucket of want.buckets) {
      const right = await rightChart(want, chart.type, days, bucket, metrics);
      if (right && comparable(right) === got) return true;
    }
  }
  return false;
}

/** The right chart for these days and bucket, or nothing when DashGen can't draw one. */
export async function rightChart(
  want: ChartExpectation,
  type: Chart["type"],
  days: number,
  bucket: Bucket,
  metrics: Metrics,
): Promise<Chart | undefined> {
  try {
    const results = new Map<string, MetricsResult>();
    for (const [i, service] of want.services.entries()) {
      results.set(
        `q${String(i + 1)}`,
        await metrics.query({ service, metric: want.metric, days, bucket }),
      );
    }
    return buildChart(
      {
        type,
        sources: [...results.keys()],
        title: "The right chart",
        aggregation: want.aggregation,
      },
      results,
    );
  } catch (error) {
    // DashGen refuses this chart, as the agent would be told: no right chart
    // with these days and bucket. Anything else, like a database error, isn't
    // a grade, so it goes up to the runner.
    if (error instanceof ToolError || error instanceof MetricsError) {
      return undefined;
    }
    throw error;
  }
}

/** A chart's numbers, in a fixed order, for comparing: everything but its type and title. */
function comparable(chart: Chart): string {
  const series = chart.series
    .map((s) => ({
      name: s.name,
      points:
        chart.x === "category"
          ? [...s.points].sort((a, b) => a.x.localeCompare(b.x))
          : s.points,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify({ unit: chart.unit, x: chart.x, series });
}
