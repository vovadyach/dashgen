import type { Chart } from "@dashgen/contracts";
import type {
  AgAreaSeriesOptions,
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

import {
  formatDay,
  formatHour,
  formatTick,
  formatValue,
  formatX,
  xValuesOf,
} from "./format.ts";
import { type Colors, type Mode, PALETTE, seriesColor } from "./palette.ts";
import { peak } from "./summary.ts";

/** A point as AG Charts reads it. */
export interface Datum {
  /** A Date on a time axis, else the point's own x: an ISO time or a service. */
  x: Date | string;
  /** Null for a bar a series doesn't have, which AG Charts leaves out. */
  y: number | null;
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
// The wash under a line alone: the line's color, faint.
const WASH_OPACITY = 0.1;
// Roughly what the y-axis and its labels take from the chart's width.
const Y_AXIS_WIDTH = 48;
const BAR_PADDING = 0.4;
// Thin marks: a bar at most this wide, and a dot only where each gets this much room.
const MAX_BAR_WIDTH = 24;
const MIN_DOT_ROOM = 14;

/** How many day labels fit across a chart `width` pixels wide. */
export const dayLabelsFor = (width: number): number =>
  Math.max(2, Math.floor((width - Y_AXIS_WIDTH) / 60));

/** The AG Charts options that draw `chart` in the `mode` theme, `width` pixels wide. */
export function chartOptions(
  chart: Chart,
  mode: Mode,
  width = 640,
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
  const plotWidth = width - Y_AXIS_WIDTH;
  const categories = xValuesOf(chart);
  return {
    ...common,
    // A single series needs no legend: the title names it.
    legend: { enabled: chart.series.length > 1, position: "bottom" },
    // One tooltip lists every series at the x it points to.
    tooltip: { mode: "shared" },
    axes: {
      x: xAxis(chart, width),
      y: {
        type: "number",
        position: "left",
        label: {
          formatter: ({ value }: { value: unknown }) =>
            formatTick(Number(value), chart.unit),
        },
      },
    },
    series: chart.series.map((series, index) => {
      const color = seriesColor(colors, index);
      if (chart.type === "line") {
        const dots = plotWidth / categories.length >= MIN_DOT_ROOM;
        // Only a line alone gets its peak labeled and a wash under it:
        // several lines' labels and washes would cover each other.
        const alone = chart.series.length === 1;
        return line(chart, series, color, colors, dots, alone);
      }
      // AG Charts splits each band between the series. Without a fixed
      // width, which would make it cut off bars that don't fit, a share of
      // the band keeps each bar thin.
      const share =
        ((plotWidth / categories.length) * (1 - BAR_PADDING)) /
        chart.series.length;
      return bar(chart, series, color, categories, MAX_BAR_WIDTH / share);
    }),
  };
}

/** The points of `series`, with Dates for a line over time. */
export function toData(series: Series, chart: Chart): Datum[] {
  const onTimeAxis = chart.type === "line" && chart.x !== "category";
  return series.points.map((point) => ({
    x: onTimeAxis ? new Date(point.x) : point.x,
    y: point.y,
    label: formatX(point.x, chart.x),
    name: series.name,
    ...(point.partial ? { partial: true as const } : {}),
  }));
}

function xAxis(chart: Chart, width: number): AgCartesianAxisOptions {
  // Bars sit in bands, one per service, day or hour. Each band is keyed by
  // its exact time, since two hours can share a label on the night the
  // clocks go back, and labeled with our own labels, which keep days in UTC.
  if (chart.type === "bar" || chart.x === "category") {
    return {
      type: "category",
      position: "bottom",
      paddingInner: BAR_PADDING,
      label: {
        formatter: ({ value }: { value: unknown }) =>
          formatX(String(value), chart.x),
      },
    };
  }
  // AG Charts rounds a time axis out to whole steps unless told not to, so
  // the axis would run past the data, even into future days.
  if (chart.x === "hour") {
    // Ticks fall on the visitor's whole hours, labeled like the tooltips.
    return {
      type: "time",
      position: "bottom",
      nice: false,
      label: {
        formatter: ({ value }: { value: unknown }) => formatHour(toDate(value)),
      },
    };
  }
  const days = Math.max(...chart.series.map((s) => s.points.length));
  return {
    type: "time",
    position: "bottom",
    nice: false,
    // Ticks on UTC midnights, where the points are. With a fixed step, AG
    // Charts shows every tick, so the step leaves room for each label.
    interval: {
      step: {
        unit: "day",
        step: Math.ceil(days / dayLabelsFor(width)),
        utc: true,
      },
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
  dots: boolean,
  alone: boolean,
): AgLineSeriesOptions<Datum> | AgAreaSeriesOptions<Datum> {
  const data = toData(series, chart);
  // The one point with a label: the peak, the same one the summary over the
  // chart names.
  const top = peak(series, chart.unit);
  const topDatum = data[series.points.indexOf(top)];
  const options: AgLineSeriesOptions<Datum> = {
    type: "line",
    data,
    xKey: "x",
    yKey: "y",
    yName: series.name,
    stroke: color,
    strokeWidth: 2,
    marker: {
      // Dots that would touch, like a month of days on a phone, crowd the line.
      enabled: dots,
      size: 8,
      fill: color,
      // A ring in the card's color keeps each dot clear of the lines it crosses.
      stroke: colors.surface,
      strokeWidth: 2,
      itemStyler: ({ datum }) =>
        datum.partial ? { fillOpacity: PARTIAL_OPACITY } : {},
    },
    segmentation: dashedPartials(data),
    label: {
      enabled: alone,
      fontWeight: 600,
      formatter: ({ datum }) =>
        datum === topDatum ? formatValue(top.y, chart.unit) : "",
    },
    tooltip: { renderer: ({ datum }) => tooltip(datum, chart.unit) },
  };
  if (!alone) return options;
  // A line alone gets a light wash under it, as an area. An area starts at
  // 0, so the axis does too.
  return { ...options, type: "area", fill: color, fillOpacity: WASH_OPACITY };
}

function bar(
  chart: Chart,
  series: Series,
  color: string,
  categories: string[],
  widthRatio: number,
): AgBarSeriesOptions<Datum> {
  const points = new Map(toData(series, chart).map((d) => [d.x, d]));
  return {
    type: "bar",
    // Every series lists every category, in order, since AG Charts orders
    // the axis by first appearance. A point it lacks draws no bar.
    data: categories.map(
      (x) =>
        points.get(x) ?? {
          x,
          y: null,
          label: formatX(x, chart.x),
          name: series.name,
        },
    ),
    xKey: "x",
    yKey: "y",
    yName: series.name,
    fill: color,
    cornerRadius: 4,
    widthRatio: Math.min(1, widthRatio),
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
        datum.y === null
          ? "–"
          : formatValue(datum.y, unit) +
            (datum.partial ? " (partial day)" : ""),
    },
  ],
});

/**
 * Dashes the line into and out of each partial day. AG Charts draws each part
 * of a segmented line only inside a segment, so solid ones fill the gaps.
 */
export function dashedPartials(
  data: Datum[],
): AgSeriesSegmentation<AgSeriesLineSegmentOptions> {
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
  // AG Charts drops the segments of segmentation that's off, and then fails
  // to redraw a line that had some: the old chart stays on screen. So a line
  // without partial days gets one plain segment, the whole line.
  if (dashed.length === 0) return { enabled: true, key: "x", segments: [{}] };

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
