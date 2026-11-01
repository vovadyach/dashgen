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
  dayLabelsFor,
} from "../src/chart/options.ts";
import { PALETTE } from "../src/chart/palette.ts";
import { CHART } from "./fixtures/run.ts";

const cartesian = (
  chart: Chart,
  mode: "light" | "dark" = "light",
  dayLabels?: number,
) => chartOptions(chart, mode, dayLabels) as AgCartesianChartOptions<Datum>;
const lineOf = (chart: Chart, index = 0) =>
  cartesian(chart).series?.[index] as AgLineSeriesOptions<Datum>;

const day = (date: number) => new Date(Date.UTC(2026, 9, date));

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
    const x = cartesian(CHART).axes?.x;
    expect(x).toMatchObject({
      type: "time",
      interval: { step: { unit: "day", step: 1, utc: true } },
    });
    const label = x?.label as { formatter: (p: { value: Date }) => string };
    expect(label.formatter({ value: day(25) })).toBe("Oct 25");
  });

  it("leaves room for each day's label: every day when wide, every other day on a phone", () => {
    const step = (width: number) =>
      (
        cartesian(CHART, "light", dayLabelsFor(width)).axes?.x as {
          interval: { step: { step: number } };
        }
      ).interval.step.step;
    expect(step(640)).toBe(1);
    expect(step(310)).toBe(2);
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

  it("draws an hourly line without dots, in the visitor's time zone", () => {
    const hourly: Chart = { ...CHART, x: "hour" };
    expect(lineOf(hourly).marker?.enabled).toBe(false);
    expect(cartesian(hourly).axes?.x).toEqual({
      type: "time",
      position: "bottom",
    });
  });

  it("puts bars in bands with our own labels, so days stay in UTC", () => {
    const bars = cartesian({ ...CHART, type: "bar" });
    expect(bars.axes?.x?.type).toBe("category");
    const series = bars.series?.[0] as AgBarSeriesOptions<Datum>;
    expect(series.data?.[0]?.x).toBe("Oct 25");
  });

  it("keeps a few bars thin, with air between them", () => {
    const series = cartesian(BY_SERVICE).series?.[0] as AgBarSeriesOptions;
    expect(series).toMatchObject({ width: 24, cornerRadius: 4 });
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

  it("leaves a line without partial days solid", () => {
    expect(dashedPartials(days(7, []))).toBeUndefined();
  });

  it("dashes into and out of a partial day in the middle", () => {
    expect(dashedPartials(days(7, [3]))?.segments).toEqual([
      { stop: day(27) },
      { start: day(27), stop: day(29), ...dash },
      { start: day(29) },
    ]);
  });

  it("merges partial days next to each other into one dashed stretch", () => {
    expect(dashedPartials(days(7, [2, 3]))?.segments).toEqual([
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
    expect(formatX("2026-10-30T21:00:00.000Z", "hour")).toBe("Oct 30, 2 PM");
  });

  it("show values with their units, and compact ticks from 1,000 up", () => {
    expect(formatValue(1284, "count")).toBe("1,284");
    expect(formatValue(342.25, "ms")).toBe("342.3 ms");
    expect(formatTick(1284, "count")).toBe("1.3K");
    expect(formatTick(300, "ms")).toBe("300 ms");
  });
});
