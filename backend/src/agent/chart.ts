import { Chart, type MetricsResult } from "@dashgen/contracts";

import { ToolError } from "./errors.ts";
import type { Aggregation, CreateChartArgs } from "./types.ts";
import { checkChart, findResults } from "./validation.ts";

// The summary comes from the hourly rows, so all but the total describe hours,
// whatever the bucket. The series name says so, or "average" could read as per day.
const AGGREGATION_LABELS: Record<Aggregation, string> = {
  total: "total",
  avg: "hourly average",
  max: "highest hour",
  min: "lowest hour",
  latest: "last hour",
};

/**
 * Builds the chart that create_chart asks for, from the query results it names.
 * The tool has already checked the arguments' shape. A chart that can't be
 * drawn honestly throws a ToolError telling the model what to change.
 */
export function buildChart(
  args: CreateChartArgs,
  results: ReadonlyMap<string, MetricsResult>,
): Chart {
  const sources = findResults(args.sources, results);
  checkChart(args, sources);

  const [first] = sources;
  if (!first) throw new ToolError("Name at least one result in sources.");
  return Chart.parse(
    args.aggregation === undefined
      ? overTime(args, sources, first)
      : byService(args, sources, first, args.aggregation),
  );
}

// checkChart makes every source like `first` in metric, unit, days and bucket.

/** One series per service, over time. */
function overTime(
  args: CreateChartArgs,
  sources: MetricsResult[],
  first: MetricsResult,
): Chart {
  return {
    type: args.type,
    title: args.title,
    unit: first.unit,
    x: first.bucket,
    series: sources.map((s) => ({
      name: s.service,
      points: s.points.map((p) => ({
        x: p.t,
        y: p.value,
        ...(p.partial ? { partial: true as const } : {}),
      })),
    })),
  };
}

/** One number per service, taken from each result's summary. */
function byService(
  args: CreateChartArgs,
  sources: MetricsResult[],
  first: MetricsResult,
  aggregation: Aggregation,
): Chart {
  return {
    type: args.type,
    title: args.title,
    unit: first.unit,
    x: "category",
    series: [
      {
        name: `${first.metric}, ${AGGREGATION_LABELS[aggregation]}`,
        points: sources.map((s) => {
          const y = s.summary[aggregation];
          // checkChart refuses a total of a metric that has none, so this is a bug.
          if (y === undefined) {
            throw new Error(`${s.service} ${s.metric} has no ${aggregation}`);
          }
          return { x: s.service, y };
        }),
      },
    ],
  };
}
