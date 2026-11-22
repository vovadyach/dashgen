import type { Chart } from "@dashgen/contracts";
import type { CSSProperties } from "react";

// Apart from options.ts, so the page's own code can size a chart's space
// without loading AG Charts' code first.

/** Whether the chart has a legend: a pie names its slices there, and lines and bars name 2 or more services. */
export const hasLegend = (chart: Chart) =>
  chart.type === "pie" || chart.series.length > 1;

/** How many entries its legend lists: a pie's slices, or the services. */
export const legendEntries = (chart: Chart) =>
  chart.type === "pie"
    ? (chart.series[0]?.points.length ?? 0)
    : chart.series.length;

/** The height of a legend entry, in pixels. On a phone, each takes a line. */
export const LEGEND_ROW = 24;

/**
 * The chart's height. A phone's legend lists an entry per line, so there a
 * chart with a legend grows by a line per entry, or AG Charts would squeeze
 * the plot, page the legend, or drop it. From `sm` on, entries share lines.
 */
export function chartHeight(chart: Chart): {
  className: string;
  style?: CSSProperties;
} {
  if (!hasLegend(chart)) return { className: "h-72 sm:h-96" };
  return {
    className: "h-[calc(18rem_+_var(--legend-entries)_*_1.5rem)] sm:h-96",
    style: { "--legend-entries": legendEntries(chart) } as CSSProperties,
  };
}
