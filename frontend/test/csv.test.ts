import type { Chart } from "@dashgen/contracts";
import { describe, expect, it } from "vitest";

import { chartCsv } from "../src/chart/csv.ts";
import { CHART } from "./fixtures/run.ts";

const lines = (chart: Chart) => chartCsv(chart).split("\r\n");

describe("chartCsv", () => {
  it("puts a day per row and a service per column, with dates and a partial column", () => {
    expect(lines(CHART)).toEqual([
      "day (UTC),payments-service,partial",
      "2026-10-25,26,",
      "2026-10-26,36,",
      "2026-10-27,35,",
      "2026-10-28,39,",
      "2026-10-29,94,",
      "2026-10-30,32,",
      "2026-10-31,28,yes",
    ]);
  });

  it("leaves a day a service lacks empty, and has no partial column when every day is whole", () => {
    const two: Chart = {
      ...CHART,
      series: [
        {
          name: "auth-service",
          points: [{ x: "2026-10-25T00:00:00.000Z", y: 4 }],
        },
        {
          name: "checkout-api",
          points: [
            { x: "2026-10-25T00:00:00.000Z", y: 7 },
            { x: "2026-10-26T00:00:00.000Z", y: 9 },
          ],
        },
      ],
    };
    expect(lines(two)).toEqual([
      "day (UTC),auth-service,checkout-api",
      "2026-10-25,4,7",
      "2026-10-26,,9",
    ]);
  });

  it("writes hours as ISO times, and services side by side by name", () => {
    const hourly: Chart = {
      ...CHART,
      x: "hour",
      unit: "ms",
      series: [
        {
          name: "search-service",
          points: [{ x: "2026-10-30T21:00:00.000Z", y: 182.5 }],
        },
      ],
    };
    expect(lines(hourly)).toEqual([
      "hour (UTC),search-service",
      "2026-10-30T21:00:00.000Z,182.5",
    ]);
    const bars: Chart = {
      ...CHART,
      type: "bar",
      x: "category",
      series: [{ name: "errors", points: [{ x: "checkout-api", y: 351 }] }],
    };
    expect(lines(bars)).toEqual(["service,errors", "checkout-api,351"]);
  });

  it("quotes a name with a comma or a quote, and keeps one that looks like a formula from running", () => {
    const odd: Chart = {
      ...CHART,
      type: "bar",
      x: "category",
      series: [
        {
          name: 'errors, "all"',
          points: [
            { x: "=HYPERLINK(1)", y: 5 },
            { x: "@team", y: 3 },
          ],
        },
      ],
    };
    expect(lines(odd)).toEqual([
      'service,"errors, ""all"""',
      "'=HYPERLINK(1),5",
      "'@team,3",
    ]);
  });

  it("keeps a formula from running after a line break or spaces, which some spreadsheets drop, but leaves numbers alone", () => {
    const hidden: Chart = {
      ...CHART,
      type: "bar",
      x: "category",
      series: [
        {
          name: "errors, total",
          points: [
            { x: "\n=1+1", y: -5 },
            { x: "  =SUM(A1)", y: 2.5 },
            { x: "auth-service", y: 0 },
          ],
        },
      ],
    };
    expect(lines(hidden)).toEqual([
      'service,"errors, total"',
      // Guarded, then quoted for its line break.
      '"\'\n=1+1",-5',
      "'  =SUM(A1),2.5",
      "auth-service,0",
    ]);
  });
});
