import type { Chart } from "@dashgen/contracts";

import { formatValue, formatX } from "./format.ts";

type Series = Chart["series"][number];
type Point = Series["points"][number];

/** The number a pinned chart's card leads with, what it is, and the series it comes from. */
export interface Headline {
  value: string;
  label: string;
  series: Series;
}

/** One of the numbers over a chart: what it is, the number, and where it comes from, like "in 7 days". */
export interface Stat {
  label: string;
  value: string;
  note: string;
}

const SHARE = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 1,
});

/**
 * The one number that sums up `chart`, worked out by the page from the
 * chart's own points, never by the model:
 * - services side by side, as bars or a pie: the highest one;
 * - one series over time: its total, for counts, or else its average;
 * - several over time: the highest of those.
 */
export function headline(chart: Chart): Headline {
  const [first, ...rest] = chart.series;
  // The schema promises a series, with a point.
  if (!first) throw new Error("A chart needs a series");
  if (chart.x === "category") {
    const points = chart.series.flatMap((series) => series.points);
    const top = highest(points, (point) => point.y);
    const total = sum(points);
    // A pie of counts is about shares, like the ring on its card. Averages
    // don't add up to a whole, so their pie keeps the plain highest.
    if (chart.type === "pie" && chart.unit === "count" && total > 0) {
      return {
        value: SHARE.format(top.y / total),
        label: `${top.x}, the largest share`,
        series: first,
      };
    }
    return {
      value: formatValue(top.y, chart.unit),
      label: `${top.x}, the highest`,
      series: first,
    };
  }
  const sizes = [first, ...rest].map((series) => ({
    series,
    size: summarize(series, chart.unit),
  }));
  const top = highest(sizes, (item) => item.size);
  return {
    value: formatValue(top.size, chart.unit),
    label:
      rest.length > 0
        ? `${top.series.name}, the highest`
        : chart.unit === "count"
          ? "total"
          : "average",
    series: top.series,
  };
}

/**
 * The numbers over a chart's card, worked out by the page from the chart's
 * own points, never by the model. Only numbers that are honest for the
 * chart's shape, the whole before its parts:
 * - one series over time: its total, for counts, or else its average; its
 *   peak; and its daily or hourly average, for counts, or else its lowest;
 * - several over time: for counts, the total of them all and the highest
 *   service's; for other units, the highest and lowest averages; and the
 *   peak, with its service;
 * - services side by side, as bars: the highest and the lowest;
 * - a pie of counts: the total, and the largest and smallest shares of it.
 * A chart of a single point gets none: the point says it all.
 */
export function summary(chart: Chart): Stat[] {
  const points = chart.series.flatMap((series) => series.points);
  if (points.length < 2) return [];
  if (chart.type === "pie") return shares(chart, points);
  if (chart.x === "category") return extremes(chart, points);
  const [first, ...rest] = chart.series;
  return first && rest.length === 0
    ? oneOverTime(chart, first)
    : severalOverTime(chart);
}

/**
 * The highest point of `series`, which the chart labels. Counts add up, so a
 * partial day has at least its count, and can be the peak. Other units leave
 * partial points out, as averages do.
 */
export function peak(series: Series, unit: string): Point {
  const points = unit === "count" ? series.points : complete(series.points);
  return highest(points, (point) => point.y);
}

/** One series over time, like a service's errors this week. */
function oneOverTime(chart: Chart, series: Series): Stat[] {
  const { unit } = chart;
  const { points } = series;
  const step = stepOf(chart);
  const top = peak(series, unit);
  const peakStat = {
    label: "Peak",
    value: formatValue(top.y, unit),
    note: on(top, chart),
  };
  if (unit !== "count") {
    const used = complete(points);
    const low = lowest(used, (point) => point.y);
    return [
      {
        label: "Average",
        value: formatValue(summarize(series, unit), unit),
        note: over(used, points, step),
      },
      peakStat,
      {
        label: "Lowest",
        value: formatValue(low.y, unit),
        note: on(low, chart),
      },
    ];
  }
  const stats = [
    {
      label: "Total",
      value: formatValue(summarize(series, unit), unit),
      note: `in ${count(points.length, step)}`,
    },
    peakStat,
  ];
  // A partial day's count would pull the average down, so with no full day
  // there's no average.
  const full = points.filter((point) => !point.partial);
  if (full.length > 0) {
    stats.push({
      label: step === "hour" ? "Hourly average" : "Daily average",
      value: formatValue(sum(full) / full.length, unit),
      note: over(full, points, step),
    });
  }
  return stats;
}

/** Several series over time, like each service's errors this week. */
function severalOverTime(chart: Chart): Stat[] {
  const { unit } = chart;
  const sizes = chart.series.map((series) => ({
    series,
    size: summarize(series, unit),
  }));
  const top = highest(sizes, (s) => s.size);
  const peaks = chart.series.map((series) => ({
    series,
    point: peak(series, unit),
  }));
  const high = highest(peaks, (p) => p.point.y);
  const peakStat = {
    label: "Peak",
    value: formatValue(high.point.y, unit),
    note: `${high.series.name} ${on(high.point, chart)}`,
  };
  if (unit === "count") {
    const points = chart.series.flatMap((series) => series.points);
    const steps = new Set(points.map((point) => point.x)).size;
    return [
      {
        label: "Total",
        value: formatValue(sum(points), unit),
        note: `${count(chart.series.length, "service")} in ${count(steps, stepOf(chart))}`,
      },
      {
        label: "Highest total",
        value: formatValue(top.size, unit),
        note: top.series.name,
      },
      peakStat,
    ];
  }
  // Services don't take the same share of requests, so an average of their
  // averages would mislead: the extremes are honest.
  const bottom = lowest(sizes, (s) => s.size);
  return [
    {
      label: "Highest average",
      value: formatValue(top.size, unit),
      note: top.series.name,
    },
    {
      label: "Lowest average",
      value: formatValue(bottom.size, unit),
      note: bottom.series.name,
    },
    peakStat,
  ];
}

/**
 * Services side by side, as bars. Their numbers could be totals, averages or
 * highest hours, and only totals add up, so there's no total.
 */
function extremes(chart: Chart, points: Point[]): Stat[] {
  const top = highest(points, (point) => point.y);
  const bottom = lowest(points, (point) => point.y);
  return [
    { label: "Highest", value: formatValue(top.y, chart.unit), note: top.x },
    {
      label: "Lowest",
      value: formatValue(bottom.y, chart.unit),
      note: bottom.x,
    },
  ];
}

/** A pie: each service's share of a total. Only counts add up to one. */
function shares(chart: Chart, points: Point[]): Stat[] {
  const total = sum(points);
  if (
    chart.unit !== "count" ||
    total <= 0 ||
    points.some((point) => point.y < 0)
  ) {
    return [];
  }
  const top = highest(points, (point) => point.y);
  const bottom = lowest(points, (point) => point.y);
  return [
    {
      label: "Total",
      value: formatValue(total, chart.unit),
      note: `across ${count(points.length, "service")}`,
    },
    {
      label: "Largest share",
      value: SHARE.format(top.y / total),
      note: top.x,
    },
    {
      label: "Smallest share",
      value: SHARE.format(bottom.y / total),
      note: bottom.x,
    },
  ];
}

/**
 * Counts add up over time. Other units, like ms, are an average per hour or
 * day, and an average of those leaves out partial ones, unless that's all
 * there is.
 */
function summarize(series: Series, unit: string): number {
  if (unit === "count") return sum(series.points);
  const points = complete(series.points);
  return sum(points) / points.length;
}

/** The points with whole days or hours of data, or all of them when none has. */
function complete(points: Point[]): Point[] {
  const full = points.filter((point) => !point.partial);
  return full.length > 0 ? full : points;
}

/** The first item with the highest value. */
const highest = <T>(items: T[], value: (item: T) => number): T =>
  items.reduce((a, b) => (value(b) > value(a) ? b : a));

/** The first item with the lowest value. */
const lowest = <T>(items: T[], value: (item: T) => number): T =>
  items.reduce((a, b) => (value(b) < value(a) ? b : a));

const sum = (points: Point[]) =>
  points.reduce((total, point) => total + point.y, 0);

const stepOf = (chart: Chart) => (chart.x === "hour" ? "hour" : "day");

/** Like "7 days" or "1 hour". */
const count = (n: number, noun: string) =>
  `${String(n)} ${noun}${n === 1 ? "" : "s"}`;

/** What an average covers, like "over 6 full days", saying "full" when it leaves partial ones out. */
const over = (used: Point[], points: Point[], step: string) =>
  `over ${count(used.length, used.length < points.length ? `full ${step}` : step)}`;

/** When a point was, like "on Oct 28", saying so when its day is partial. */
const on = (point: Point, chart: Chart) =>
  `on ${formatX(point.x, chart.x)}${point.partial ? " (partial day)" : ""}`;
