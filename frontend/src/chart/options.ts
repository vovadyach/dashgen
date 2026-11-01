import type { Chart } from "@dashgen/contracts";
import type {
  AgBarSeriesOptions,
  AgCartesianAxisOptions,
  AgChartOptions,
  AgChartTheme,
  AgLineSeriesOptions,
  AgPieSeriesOptions,
  AgSeriesLineSegmentOptions,
  AgSeriesSegmentation,
  AgTooltipRendererResult,
} from "ag-charts-community";

import { formatDay, formatTick, formatValue, formatX } from "./format.ts";
import { type Colors, type Mode, PALETTE, seriesColor } from "./palette.ts";

/** A point as AG Charts reads it. */
export interface Datum {
  /** A Date on a time axis, else the label itself, as a category. */
  x: Date | string;
  y: number;
  /** The x value as people read it. */
  label: string;
  /** The series the point belongs to. */
  name: string;
  partial?: true;
}

type Series = Chart["series"][number];

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
// A day with fewer than 24 hours of data is drawn lighter, and the line into
// and out of it dashed, so it reads as incomplete, not as a drop.
const PARTIAL_OPACITY = 0.4;
const DASH = [4, 4];

/** How many day labels fit across a chart `width` pixels wide, beside its y-axis. */
export const dayLabelsFor = (width: number): number =>
  Math.max(2, Math.floor((width - 48) / 60));

/**
 * The AG Charts options that draw `chart` in the `mode` theme, with at most
 * `dayLabels` labels on a daily x-axis.
 */
export function chartOptions(
  chart: Chart,
  mode: Mode,
  dayLabels = 7,
): AgChartOptions {
  const colors = PALETTE[mode];
  const common = {
    theme: theme(colors, mode),
    background: { fill: colors.surface },
  };
  if (chart.type === "pie") {
    return {
      ...common,
      // Each slice is a service, and the legend names them.
      legend: { enabled: true, position: "bottom" },
      series: [pie(chart, colors)],
    };
  }
  return {
    ...common,
    // A single series needs no legend: the title names it.
    legend: { enabled: chart.series.length > 1, position: "bottom" },
    // One tooltip lists every series at the x it points to.
    tooltip: { mode: "shared" },
    axes: {
      x: xAxis(chart, dayLabels),
      y: {
        type: "number",
        position: "left",
        label: {
          formatter: ({ value }: { value: unknown }) =>
            formatTick(Number(value), chart.unit),
        },
      },
    },
    series: chart.series.map((series, index) =>
      chart.type === "line"
        ? line(chart, series, seriesColor(colors, index), colors)
        : bar(chart, series, seriesColor(colors, index)),
    ),
  };
}

/** The points of `series`, with Dates for a line over time. */
export function toData(series: Series, chart: Chart): Datum[] {
  const onTimeAxis = chart.type === "line" && chart.x !== "category";
  return series.points.map((point) => {
    const label = formatX(point.x, chart.x);
    return {
      x: onTimeAxis ? new Date(point.x) : label,
      y: point.y,
      label,
      name: series.name,
      ...(point.partial ? { partial: true as const } : {}),
    };
  });
}

function xAxis(chart: Chart, dayLabels: number): AgCartesianAxisOptions {
  // Bars sit in bands, one per service, day or hour, labeled with our own
  // labels, which keep days in UTC.
  if (chart.type === "bar" || chart.x === "category") {
    return { type: "category", position: "bottom", paddingInner: 0.4 };
  }
  if (chart.x === "hour") {
    // AG Charts places and labels the ticks in the visitor's time zone.
    return { type: "time", position: "bottom" };
  }
  const days = Math.max(...chart.series.map((s) => s.points.length));
  return {
    type: "time",
    position: "bottom",
    // Ticks on UTC midnights, where the points are. With a fixed step, AG
    // Charts shows every tick, so the step leaves room for each label.
    interval: {
      step: { unit: "day", step: Math.ceil(days / dayLabels), utc: true },
    },
    label: {
      formatter: ({ value }: { value: unknown }) => formatDay(toDate(value)),
    },
  };
}

function line(
  chart: Chart,
  series: Series,
  color: string,
  colors: Colors,
): AgLineSeriesOptions<Datum> {
  const data = toData(series, chart);
  return {
    type: "line",
    data,
    xKey: "x",
    yKey: "y",
    yName: series.name,
    stroke: color,
    strokeWidth: 2,
    marker: {
      // 48 hourly dots would crowd the line.
      enabled: chart.x !== "hour",
      size: 8,
      fill: color,
      // A ring in the card's color keeps each dot clear of the lines it crosses.
      stroke: colors.surface,
      strokeWidth: 2,
      itemStyler: ({ datum }) =>
        datum.partial ? { fillOpacity: PARTIAL_OPACITY } : {},
    },
    segmentation: dashedPartials(data),
    tooltip: { renderer: ({ datum }) => tooltip(datum, chart.unit) },
  };
}

function bar(
  chart: Chart,
  series: Series,
  color: string,
): AgBarSeriesOptions<Datum> {
  return {
    type: "bar",
    data: toData(series, chart),
    xKey: "x",
    yKey: "y",
    yName: series.name,
    fill: color,
    cornerRadius: 4,
    // Thin bars when there are few, with air between them.
    ...(series.points.length <= 8 ? { width: 24 } : {}),
    itemStyler: ({ datum }) =>
      datum.partial ? { fillOpacity: PARTIAL_OPACITY } : {},
    tooltip: { renderer: ({ datum }) => tooltip(datum, chart.unit) },
  };
}

function pie(chart: Chart, colors: Colors): AgPieSeriesOptions<Datum> {
  return {
    type: "pie",
    // A pie compares services: a slice per point.
    data: chart.series.flatMap((series) => toData(series, chart)),
    angleKey: "y",
    legendItemKey: "label",
    fills: [...colors.series],
    // A gap in the card's color between slices, instead of a border.
    strokes: [colors.surface],
    strokeWidth: 2,
    tooltip: { renderer: ({ datum }) => tooltip(datum, chart.unit) },
  };
}

const tooltip = (datum: Datum, unit: string): AgTooltipRendererResult => ({
  heading: datum.label,
  data: [
    {
      label: datum.name,
      value:
        formatValue(datum.y, unit) + (datum.partial ? " (partial day)" : ""),
    },
  ],
});

/**
 * Dashes the line into and out of each partial day. AG Charts draws each part
 * of a segmented line only inside a segment, so solid ones fill the gaps.
 */
export function dashedPartials(
  data: Datum[],
): AgSeriesSegmentation<AgSeriesLineSegmentOptions> | undefined {
  const last = data.length - 1;
  // The stretches to dash, by index, merged where they touch.
  const dashed: [number, number][] = [];
  data.forEach((datum, i) => {
    if (!datum.partial) return;
    const from = Math.max(i - 1, 0);
    const to = Math.min(i + 1, last);
    const previous = dashed.at(-1);
    if (previous && from <= previous[1]) previous[1] = to;
    else dashed.push([from, to]);
  });
  if (dashed.length === 0) return undefined;

  // A segment without a start begins where the line does, and one without a
  // stop runs to its end, so no stroke is cut off at either end.
  const span = (from: number, to: number) => ({
    ...(from > 0 ? { start: data[from]?.x } : {}),
    ...(to < last ? { stop: data[to]?.x } : {}),
  });
  const segments: AgSeriesLineSegmentOptions[] = [];
  let solidFrom = 0;
  for (const [from, to] of dashed) {
    if (from > solidFrom) segments.push(span(solidFrom, from));
    segments.push({ ...span(from, to), lineDash: DASH, strokeOpacity: 0.6 });
    solidFrom = to;
  }
  if (solidFrom < last) segments.push(span(solidFrom, last));
  return { enabled: true, key: "x", segments };
}

function theme(colors: Colors, mode: Mode): AgChartTheme {
  return {
    baseTheme: mode === "dark" ? "ag-default-dark" : "ag-default",
    palette: { fills: [...colors.series], strokes: [...colors.series] },
    params: {
      fontFamily: FONT,
      fontSize: 12,
      backgroundColor: colors.surface,
      foregroundColor: colors.text,
      textColor: colors.text,
      subtleTextColor: colors.subtleText,
      gridLineColor: colors.grid,
      axisLineColor: colors.axis,
      accentColor: seriesColor(colors, 0),
      tooltipBackgroundColor: colors.surface,
      tooltipTextColor: colors.text,
      tooltipSubtleTextColor: colors.subtleText,
    },
  };
}

const toDate = (value: unknown): Date =>
  value instanceof Date ? value : new Date(Number(value));
