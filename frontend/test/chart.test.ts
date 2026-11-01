import type { Chart } from "@dashgen/contracts";
import type {
  AgBarSeriesOptions,
  AgCartesianChartOptions,
  AgLineSeriesOptions,
  AgPieSeriesOptions,
  AgPolarChartOptions,
} from "ag-charts-community";
import { describe, expect, it } from "vitest";

import {
  formatDay,
  formatTick,
  formatValue,
  formatX,
} from "../src/chart/format.ts";
import {
  chartOptions,
  dashedPartials,
  type Datum,
} from "../src/chart/options.ts";
import { PALETTE } from "../src/chart/palette.ts";
import { CHART } from "./fixtures/run.ts";

const cartesian = (
  chart: Chart,
  mode: "light" | "dark" = "light",
  width?: number,
) => chartOptions(chart, mode, width) as AgCartesianChartOptions<Datum>;
const lineOf = (chart: Chart, width?: number) =>
  cartesian(chart, "light", width).series?.[0] as AgLineSeriesOptions<Datum>;
const barsOf = (chart: Chart, width?: number) =>
  cartesian(chart, "light", width).series as AgBarSeriesOptions<Datum>[];
const xLabel = (chart: Chart, value: unknown) =>
  (
    cartesian(chart).axes?.x?.label as {
      formatter: (params: { value: unknown }) => string;
    }
  ).formatter({ value });

const day = (date: number) => new Date(Date.UTC(2026, 9, date));
const iso = (date: number) => day(date).toISOString();

/** `count` days of one service's daily errors, from Oct 25. */
const daily = (count: number): Chart => ({
  ...CHART,
  series: [
    {
      name: "payments-service",
      points: Array.from({ length: count }, (_, i) => ({
        x: iso(25 + i),
        y: i,
      })),
    },
  ],
});

/** Two services' daily errors, for charts that compare them. */
const TWO_SERVICES: Chart = {
  ...CHART,
  series: [
    CHART.series[0] ?? { name: "", points: [] },
    {
      name: "checkout-api",
      points: [
        { x: "2026-10-25T00:00:00.000Z", y: 48 },
        { x: "2026-10-26T00:00:00.000Z", y: 51 },
      ],
    },
  ],
};

const BY_SERVICE: Chart = {
  type: "bar",
  title: "Errors per service, this week",
  unit: "count",
  x: "category",
  series: [
    {
      name: "errors, total",
      points: [
        { x: "payments-service", y: 290 },
        { x: "checkout-api", y: 351 },
      ],
    },
  ],
};

describe("chartOptions", () => {
  it("draws a daily line on a time axis, with its ticks on UTC midnights", () => {
    expect(cartesian(CHART).axes?.x).toMatchObject({
      type: "time",
      interval: { step: { unit: "day", step: 1, utc: true } },
    });
    expect(xLabel(CHART, day(25))).toBe("Oct 25");
  });

  it("ends a time axis at the data, instead of rounding it out into days to come", () => {
    expect(cartesian(daily(30)).axes?.x).toMatchObject({ nice: false });
    expect(cartesian({ ...CHART, x: "hour" }).axes?.x).toMatchObject({
      nice: false,
    });
  });

  it("leaves room for each day's label: every day when wide, every other day on a phone", () => {
    const step = (width: number) =>
      (
        cartesian(CHART, "light", width).axes?.x as {
          interval: { step: { step: number } };
        }
      ).interval.step.step;
    expect(step(640)).toBe(1);
    expect(step(310)).toBe(2);
  });

  it("draws dots only where they have room: a week on a phone, but a month only when wide", () => {
    expect(lineOf(daily(7), 310).marker?.enabled).toBe(true);
    expect(lineOf(daily(30), 310).marker?.enabled).toBe(false);
    expect(lineOf(daily(30), 640).marker?.enabled).toBe(true);
  });

  it("dashes the line into today so far, and draws its dot lighter", () => {
    const line = lineOf(CHART);
    expect(line.segmentation?.segments).toEqual([
      { stop: day(30) },
      { start: day(30), lineDash: [4, 4], strokeOpacity: 0.6 },
    ]);
    const partial = line.data?.at(-1);
    expect(line.marker?.itemStyler?.({ datum: partial } as never)).toEqual({
      fillOpacity: 0.4,
    });
    expect(
      line.marker?.itemStyler?.({ datum: line.data?.[0] } as never),
    ).toEqual({});
  });

  it("puts the day, the service and the value with its unit in the tooltip, and marks a partial day", () => {
    const line = lineOf({ ...CHART, unit: "ms" });
    const tooltip = (datum: Datum | undefined) =>
      line.tooltip?.renderer?.({ datum } as never);
    expect(tooltip(line.data?.[0])).toEqual({
      heading: "Oct 25",
      data: [{ label: "payments-service", value: "26 ms" }],
    });
    expect(tooltip(line.data?.at(-1))).toEqual({
      heading: "Oct 31",
      data: [{ label: "payments-service", value: "28 ms (partial day)" }],
    });
  });

  it("labels only the peak of a lone line, with its value", () => {
    const line = lineOf(CHART);
    expect(line.label?.enabled).toBe(true);
    expect(
      line.data?.map((datum) => line.label?.formatter?.({ datum } as never)),
    ).toEqual(["", "", "", "", "94", "", ""]);
  });

  it("labels the peak the summary names, leaving out a partial day's average", () => {
    const latency: Chart = {
      ...CHART,
      unit: "ms",
      series: [
        {
          name: "checkout-api",
          points: [
            { x: iso(29), y: 300 },
            { x: iso(30), y: 320 },
            { x: iso(31), y: 900, partial: true },
          ],
        },
      ],
    };
    const line = lineOf(latency);
    expect(
      line.data?.map((datum) => line.label?.formatter?.({ datum } as never)),
    ).toEqual(["", "320 ms", ""]);
  });

  it("washes a lone line's area faintly in its color, but leaves several lines bare, with no labels", () => {
    expect(lineOf(CHART)).toMatchObject({
      type: "area",
      fill: PALETTE.light.series[0],
      fillOpacity: 0.1,
    });
    const lines = cartesian(TWO_SERVICES).series as AgLineSeriesOptions[];
    expect(lines.map((line) => [line.type, line.label?.enabled])).toEqual([
      ["line", false],
      ["line", false],
    ]);
  });

  it("gives a single series the first color, and no legend", () => {
    expect(lineOf(CHART).stroke).toBe(PALETTE.light.series[0]);
    expect(cartesian(CHART).legend?.enabled).toBe(false);
  });

  it("gives each service its own color, in order, and a legend", () => {
    const options = cartesian(TWO_SERVICES);
    expect(
      options.series?.map((s) => (s as AgLineSeriesOptions).stroke),
    ).toEqual([PALETTE.light.series[0], PALETTE.light.series[1]]);
    expect(options.legend?.enabled).toBe(true);
  });

  it("labels an hourly axis in the visitor's time zone, like its tooltips", () => {
    const hourly: Chart = { ...CHART, x: "hour" };
    expect(cartesian(hourly).axes?.x).toMatchObject({ type: "time" });
    // 21:00 UTC is 2 PM in Los Angeles, where the tests run.
    expect(xLabel(hourly, new Date("2026-10-30T21:00:00Z"))).toBe(
      "Oct 30, 2:00 PM",
    );
  });

  it("puts bars in bands keyed by their time, with our own labels, so days stay in UTC", () => {
    const bars: Chart = { ...CHART, type: "bar" };
    expect(cartesian(bars).axes?.x?.type).toBe("category");
    expect(barsOf(bars)[0]?.data?.[0]?.x).toBe(iso(25));
    expect(xLabel(bars, iso(25))).toBe("Oct 25");
  });

  it("keeps hourly bars apart on the night the clocks go back, when two hours share a label", () => {
    // In Los Angeles, 08:00 and 09:00 UTC on Nov 1 are both 1 AM.
    const hours = ["2026-11-01T08:00:00.000Z", "2026-11-01T09:00:00.000Z"];
    const data =
      barsOf({
        ...CHART,
        type: "bar",
        x: "hour",
        series: [
          { name: "auth-service", points: hours.map((x) => ({ x, y: 4 })) },
        ],
      })[0]?.data ?? [];
    expect(data.map((d) => d.x)).toEqual(hours);
    expect(data.map((d) => d.label)).toEqual([
      "Nov 1, 1:00 AM",
      "Nov 1, 1:00 AM",
    ]);
  });

  it("keeps the days in order when the first service lacks one, with no bar for it", () => {
    const [first] = barsOf({
      ...CHART,
      type: "bar",
      series: [
        {
          name: "payments-service",
          points: [25, 27].map((d) => ({ x: iso(d), y: d })),
        },
        {
          name: "checkout-api",
          points: [25, 26, 27].map((d) => ({ x: iso(d), y: d })),
        },
      ],
    });
    expect(first?.data?.map((d) => [d.x, d.y])).toEqual([
      [iso(25), 25],
      [iso(26), null],
      [iso(27), 27],
    ]);
  });

  it("keeps bars at most 24 px wide, without a fixed width, which would make AG Charts cut bars off", () => {
    // Two services on a wide chart: each band could hold a thick bar.
    const [few] = barsOf(BY_SERVICE, 640);
    expect(few?.width).toBeUndefined();
    expect(few?.widthRatio).toBeLessThan(0.2);
    // A week of five services on a phone: the bars are thin already.
    const week = barsOf(
      {
        ...CHART,
        type: "bar",
        series: Array.from({ length: 5 }, (_, s) => ({
          name: `service-${String(s)}`,
          points: [25, 26, 27, 28, 29, 30, 31].map((d) => ({
            x: iso(d),
            y: s,
          })),
        })),
      },
      310,
    );
    expect(week.map((bar) => bar.widthRatio)).toEqual([1, 1, 1, 1, 1]);
  });

  it("draws a pie with a slice per service, a gap between slices and a legend", () => {
    const options = chartOptions(
      { ...BY_SERVICE, type: "pie" },
      "light",
    ) as AgPolarChartOptions<Datum>;
    const pie = options.series?.[0] as AgPieSeriesOptions<Datum>;
    expect(pie.data?.map((d) => d.label)).toEqual([
      "payments-service",
      "checkout-api",
    ]);
    expect(pie.strokes).toEqual([PALETTE.light.surface]);
    expect(options.legend?.enabled).toBe(true);
  });

  it("takes the dark theme's colors in the dark theme", () => {
    const options = cartesian(CHART, "dark");
    expect(options.background?.fill).toBe(PALETTE.dark.surface);
    expect((options.series?.[0] as AgLineSeriesOptions).stroke).toBe(
      PALETTE.dark.series[0],
    );
  });
});

describe("dashedPartials", () => {
  const days = (count: number, partial: number[]): Datum[] =>
    Array.from({ length: count }, (_, i) => ({
      x: day(25 + i),
      y: i,
      label: "",
      name: "payments-service",
      ...(partial.includes(i) ? { partial: true as const } : {}),
    }));
  const dash = { lineDash: [4, 4], strokeOpacity: 0.6 };

  it("leaves a line without partial days solid, as one plain segment, so AG Charts can redraw a line that had dashes", () => {
    expect(dashedPartials(days(7, []))).toEqual({
      enabled: true,
      key: "x",
      segments: [{}],
    });
  });

  it("dashes into and out of a partial day in the middle", () => {
    expect(dashedPartials(days(7, [3])).segments).toEqual([
      { stop: day(27) },
      { start: day(27), stop: day(29), ...dash },
      { start: day(29) },
    ]);
  });

  it("merges partial days next to each other into one dashed stretch", () => {
    expect(dashedPartials(days(7, [2, 3])).segments).toEqual([
      { stop: day(26) },
      { start: day(26), stop: day(29), ...dash },
      { start: day(29) },
    ]);
  });
});

describe("chart labels", () => {
  it("label days in UTC, even west of UTC", () => {
    // The tests run in Los Angeles' time zone (vite.config.ts), where this
    // midnight is still Oct 24.
    expect(formatDay(new Date("2026-10-25T00:00:00Z"))).toBe("Oct 25");
  });

  it("label hours in the visitor's time zone", () => {
    // 21:00 UTC is 2 PM in Los Angeles, where the tests run.
    expect(formatX("2026-10-30T21:00:00.000Z", "hour")).toBe("Oct 30, 2:00 PM");
  });

  it("show values with their units, and compact ticks from 1,000 up", () => {
    expect(formatValue(1284, "count")).toBe("1,284");
    expect(formatValue(342.25, "ms")).toBe("342.3 ms");
    expect(formatTick(1284, "count")).toBe("1.3K");
    expect(formatTick(300, "ms")).toBe("300 ms");
  });
});
