import type { Chart } from "@dashgen/contracts";
import { describe, expect, it } from "vitest";

import { headline, serviceRows, summary } from "../src/chart/summary.ts";
import { CHART } from "./fixtures/run.ts";

const day = (date: number) => new Date(Date.UTC(2026, 9, date)).toISOString();

/** Daily points from Oct 25, the last one partial, like a week up to today. */
const days = (ys: number[]) =>
  ys.map((y, i) => ({
    x: day(25 + i),
    y,
    ...(i === ys.length - 1 ? { partial: true as const } : {}),
  }));

/** Each service's errors this week, as bars or a pie. */
const byService = (type: "bar" | "pie", unit = "count"): Chart => ({
  type,
  title: "Errors per service, this week",
  unit,
  x: "category",
  series: [
    {
      name: "errors, total",
      points: [
        { x: "payments-service", y: 290 },
        { x: "checkout-api", y: 351 },
        { x: "search-service", y: 59 },
      ],
    },
  ],
});

describe("headline", () => {
  it("adds up a count over time, today so far included", () => {
    expect(headline(CHART)).toEqual({
      value: "290",
      label: "total",
      series: CHART.series[0],
    });
  });

  it("averages other units over time, leaving out partial points", () => {
    const latency: Chart = {
      ...CHART,
      unit: "ms",
      series: [
        {
          name: "checkout-api",
          points: [
            { x: day(29), y: 300 },
            { x: day(30), y: 320 },
            { x: day(31), y: 900, partial: true },
          ],
        },
      ],
    };
    expect(headline(latency)).toMatchObject({
      value: "310 ms",
      label: "average",
    });
  });

  it("averages partial points when that's all there is", () => {
    const today: Chart = {
      ...CHART,
      unit: "ms",
      series: [
        {
          name: "checkout-api",
          points: [{ x: day(31), y: 250, partial: true }],
        },
      ],
    };
    expect(headline(today)).toMatchObject({ value: "250 ms" });
  });

  it("names the highest of several series, and draws that one", () => {
    const checkout = {
      name: "checkout-api",
      points: [
        { x: day(30), y: 20 },
        { x: day(31), y: 1 },
      ],
    };
    const two: Chart = {
      ...CHART,
      series: [
        {
          name: "payments-service",
          points: [
            { x: day(30), y: 10 },
            { x: day(31), y: 5 },
          ],
        },
        checkout,
      ],
    };
    expect(headline(two)).toEqual({
      value: "21",
      label: "checkout-api, the highest",
      series: checkout,
    });
  });

  it("names the highest service when they're side by side", () => {
    const bars: Chart = {
      type: "bar",
      title: "Slowest service over the last 3 days",
      unit: "ms",
      x: "category",
      series: [
        {
          name: "latency",
          points: [
            { x: "auth-service", y: 120 },
            { x: "checkout-api", y: 412.4 },
            { x: "search-service", y: 98 },
          ],
        },
      ],
    };
    expect(headline(bars)).toMatchObject({
      value: "412.4 ms",
      label: "checkout-api, the highest",
    });
  });
});

describe("headline of a pie", () => {
  it("gives a pie of counts its largest share, like the ring on its card", () => {
    expect(headline(byService("pie"))).toMatchObject({
      value: "50.1%",
      label: "checkout-api, the largest share",
    });
  });

  it("gives a pie of averages its plain highest, since averages don't add up to a whole", () => {
    expect(headline(byService("pie", "ms"))).toMatchObject({
      value: "351 ms",
      label: "checkout-api, the highest",
    });
  });
});

describe("serviceRows", () => {
  it("sums up a series over time: its total, its peak, and its latest point, so far", () => {
    expect(serviceRows(CHART)).toEqual([
      {
        name: "payments-service",
        color: 0,
        series: CHART.series[0],
        value: "290",
        peak: { value: "94", when: "Oct 29" },
        latest: { value: "28", when: "Oct 31, so far" },
      },
    ]);
  });

  it("averages other units over the full days, and leaves a partial one out of the peak", () => {
    const latency: Chart = {
      ...CHART,
      unit: "ms",
      series: [
        { name: "payments-service", points: days([300, 320, 280, 900]) },
        { name: "checkout-api", points: days([200, 250, 210, 100]) },
      ],
    };
    expect(serviceRows(latency)).toMatchObject([
      {
        name: "payments-service",
        color: 0,
        value: "300 ms",
        peak: { value: "320 ms", when: "Oct 26" },
        latest: { value: "900 ms", when: "Oct 28, so far" },
      },
      { name: "checkout-api", color: 1, value: "220 ms" },
    ]);
  });

  it("gives each service side by side its value and its bar, and no share, since bars could be maxima", () => {
    expect(serviceRows(byService("bar"))).toEqual([
      { name: "payments-service", color: 0, value: "290", size: 290 / 351 },
      { name: "checkout-api", color: 0, value: "351", size: 1 },
      { name: "search-service", color: 0, value: "59", size: 59 / 351 },
    ]);
  });

  it("gives a pie's slices their own colors and their shares of the whole", () => {
    const rows = serviceRows(byService("pie"));
    expect(rows.map((row) => [row.color, row.share])).toEqual([
      [0, "41.4%"],
      [1, "50.1%"],
      [2, "8.4%"],
    ]);
  });
});

describe("summary", () => {
  it("sums up a week of counts: the total with today so far, the peak, and the average of the full days", () => {
    const week: Chart = {
      ...CHART,
      series: [
        {
          name: "payments-service",
          points: days([162, 171, 158, 268, 197, 176, 152]),
        },
      ],
    };
    expect(summary(week)).toEqual([
      { label: "Total", value: "1,284", note: "in 7 days" },
      { label: "Peak", value: "268", note: "on Oct 28" },
      { label: "Daily average", value: "188.7", note: "over 6 full days" },
    ]);
  });

  it("takes today so far as the peak of counts once it's the highest, and says it's partial", () => {
    const incident: Chart = {
      ...CHART,
      series: [{ name: "auth-service", points: days([12, 15, 40]) }],
    };
    expect(summary(incident)[1]).toEqual({
      label: "Peak",
      value: "40",
      note: "on Oct 27 (partial day)",
    });
  });

  it("gives no daily average of counts when no day is full", () => {
    const partial: Chart = {
      ...CHART,
      series: [
        {
          name: "auth-service",
          points: [
            { x: day(30), y: 8, partial: true },
            { x: day(31), y: 3, partial: true },
          ],
        },
      ],
    };
    expect(summary(partial).map((stat) => stat.label)).toEqual([
      "Total",
      "Peak",
    ]);
  });

  it("averages other units over the full days, and leaves a partial day out of the peak and the lowest", () => {
    const latency: Chart = {
      ...CHART,
      unit: "ms",
      series: [{ name: "checkout-api", points: days([300, 320, 280, 900]) }],
    };
    expect(summary(latency)).toEqual([
      { label: "Average", value: "300 ms", note: "over 3 full days" },
      { label: "Peak", value: "320 ms", note: "on Oct 26" },
      { label: "Lowest", value: "280 ms", note: "on Oct 27" },
    ]);
  });

  it("sums up an hourly chart by the hour, in the visitor's time zone", () => {
    // 21:00 UTC is 2 PM in Los Angeles, where the tests run.
    const hourly: Chart = {
      ...CHART,
      x: "hour",
      series: [
        {
          name: "search-service",
          points: [
            { x: "2026-10-30T21:00:00.000Z", y: 4 },
            { x: "2026-10-30T22:00:00.000Z", y: 9 },
            { x: "2026-10-30T23:00:00.000Z", y: 5 },
          ],
        },
      ],
    };
    expect(summary(hourly)).toEqual([
      { label: "Total", value: "18", note: "in 3 hours" },
      { label: "Peak", value: "9", note: "on Oct 30, 3:00 PM" },
      { label: "Hourly average", value: "6", note: "over 3 hours" },
    ]);
  });

  it("totals several services' counts, and names the highest service and the peak's", () => {
    const two: Chart = {
      ...CHART,
      series: [
        {
          name: "payments-service",
          points: [
            { x: day(30), y: 10 },
            { x: day(31), y: 5, partial: true },
          ],
        },
        {
          name: "checkout-api",
          points: [
            { x: day(30), y: 20 },
            { x: day(31), y: 1, partial: true },
          ],
        },
      ],
    };
    expect(summary(two)).toEqual([
      { label: "Total", value: "36", note: "2 services in 2 days" },
      { label: "Highest total", value: "21", note: "checkout-api" },
      { label: "Peak", value: "20", note: "checkout-api on Oct 30" },
    ]);
  });

  it("gives several services' other units no total, only the highest and lowest averages and the peak", () => {
    const two: Chart = {
      ...CHART,
      unit: "ms",
      series: [
        { name: "payments-service", points: days([300, 320, 900]) },
        { name: "checkout-api", points: days([200, 250, 100]) },
      ],
    };
    expect(summary(two)).toEqual([
      { label: "Highest average", value: "310 ms", note: "payments-service" },
      { label: "Lowest average", value: "225 ms", note: "checkout-api" },
      { label: "Peak", value: "320 ms", note: "payments-service on Oct 26" },
    ]);
  });

  it("names the highest and lowest service side by side, with no total, since bars could be averages", () => {
    expect(summary(byService("bar"))).toEqual([
      { label: "Highest", value: "351", note: "checkout-api" },
      { label: "Lowest", value: "59", note: "search-service" },
    ]);
  });

  it("gives a pie its total, and the largest and smallest shares of it", () => {
    expect(summary(byService("pie"))).toEqual([
      { label: "Total", value: "700", note: "across 3 services" },
      { label: "Largest share", value: "50.1%", note: "checkout-api" },
      { label: "Smallest share", value: "8.4%", note: "search-service" },
    ]);
  });

  it("shows no numbers where none would be honest: one point, a pie of nothing, or a pie of averages", () => {
    const today: Chart = {
      ...CHART,
      series: [{ name: "auth-service", points: days([12]) }],
    };
    const pie = byService("pie");
    const nothing: Chart = {
      ...pie,
      series: pie.series.map((series) => ({
        ...series,
        points: series.points.map((point) => ({ ...point, y: 0 })),
      })),
    };
    expect(summary(today)).toEqual([]);
    expect(summary(nothing)).toEqual([]);
    expect(summary(byService("pie", "ms"))).toEqual([]);
  });
});
