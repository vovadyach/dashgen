import type { Chart } from "@dashgen/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ServiceTable } from "../src/components/service-table.tsx";
import { ThemeProvider } from "../src/theme.tsx";
import { CHART } from "./fixtures/run.ts";

const headings = (chart: Chart) => {
  render(
    <ThemeProvider>
      <ServiceTable chart={chart} />
    </ThemeProvider>,
  );
  // Date ranges space their dash with thin spaces.
  return screen
    .getAllByRole("columnheader")
    .map((heading) => heading.textContent.replace(/\s/g, " "));
};

const byService = (type: "bar" | "pie", name: string): Chart => ({
  type,
  title: "Errors per service, this week",
  unit: "count",
  x: "category",
  series: [
    {
      name,
      points: [
        { x: "payments-service", y: 290 },
        { x: "checkout-api", y: 351 },
      ],
    },
  ],
});

describe("ServiceTable", () => {
  it("dates a trend by its first and last points, even when it skips days", () => {
    const sparse: Chart = {
      ...CHART,
      series: [
        {
          name: "payments-service",
          points: [
            { x: "2026-10-25T00:00:00.000Z", y: 26 },
            { x: "2026-10-31T00:00:00.000Z", y: 28, partial: true },
          ],
        },
      ],
    };
    expect(headings(sparse)).toEqual([
      "Service",
      "Oct 25 – 31",
      "Total",
      "Peak",
      "Latest",
    ]);
  });

  it("names the values side by side as the backend named them, since bars can be any aggregation", () => {
    expect(headings(byService("bar", "latency_ms, highest hour"))).toEqual([
      "Service",
      "latency_ms, highest hour",
    ]);
  });

  it("gives a pie a share column, since a pie is always a whole", () => {
    expect(headings(byService("pie", "errors, total"))).toEqual([
      "Service",
      "errors, total",
      "Share",
    ]);
  });
});
