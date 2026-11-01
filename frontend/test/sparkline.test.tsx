import type { Chart } from "@dashgen/contracts";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sparkline } from "../src/components/sparkline.tsx";

const shares = {
  name: "errors, total",
  points: [
    { x: "payments-service", y: 290 },
    { x: "checkout-api", y: 351 },
    { x: "search-service", y: 59 },
  ],
};

const chartOf = (type: Chart["type"]): Chart => ({
  type,
  title: "Errors per service, this week",
  unit: "count",
  x: "category",
  series: [shares],
});

// The mini chart is decoration, hidden from screen readers, so its parts
// are found by their class.
const drawn = (chart: Chart) => {
  const { container } = render(<Sparkline chart={chart} series={shares} />);
  return {
    slices: [...container.querySelectorAll(".sparkline-slice")],
    bars: container.querySelectorAll(".sparkline-bar").length,
  };
};

describe("Sparkline", () => {
  it("draws a pie as a ring of slices in order, the largest share in color", () => {
    const { slices, bars } = drawn(chartOf("pie"));
    expect(bars).toBe(0);
    expect(
      slices.map((slice) =>
        slice.getAttribute("class")?.includes("stroke-primary"),
      ),
    ).toEqual([false, true, false]);
    // Each slice starts where the one before it ends, round the ring, with
    // a small gap after it: 290, 351 and 59 of 700.
    expect(
      slices.map((slice) => [
        slice.getAttribute("stroke-dashoffset"),
        slice.getAttribute("stroke-dasharray"),
      ]),
    ).toEqual([
      ["0.0000", "0.3943 1"],
      ["-0.4143", "0.4814 1"],
      ["-0.9157", "0.0643 1"],
    ]);
  });

  it("draws services side by side as bars, when they aren't a pie", () => {
    const { slices, bars } = drawn(chartOf("bar"));
    expect(slices).toHaveLength(0);
    expect(bars).toBe(3);
  });
});
