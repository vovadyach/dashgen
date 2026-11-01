import type { Chart } from "@dashgen/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CHART, CHART_OUTCOME, RUN_ID, SECOND_RUN_ID } from "./fixtures/run.ts";
import { FakeEventSource, lastStream } from "./helpers/event-source.ts";
import { ask, renderPage, started, stubTheBrowser } from "./helpers/page.tsx";

// The numbers over one chart can't be worked out, as for a chart with a
// time the page can't read.
vi.mock(import("../src/chart/summary.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    summary: (chart) => {
      if (chart.title === "A chart that can't be shown") {
        throw new RangeError("Invalid time value");
      }
      return actual.summary(chart);
    },
  };
});

// jsdom has no canvas, so the chart is a stand-in.
vi.mock("../src/components/chart-view.tsx", () => ({
  default: ({ chart }: { chart: Chart }) => <p>{`${chart.type} chart`}</p>,
}));

stubTheBrowser();

describe("the page, when a chart's card can't be shown", () => {
  it("says so in its place, keeps the page, and shows the next chart", async () => {
    // React reports the error it caught to the console.
    const console = vi.spyOn(globalThis.console, "error");
    console.mockImplementation(() => undefined);
    started(RUN_ID, SECOND_RUN_ID);
    const user = renderPage();
    await ask(user);
    const first = await waitFor(lastStream);
    act(() => {
      first.send({
        ...CHART_OUTCOME,
        chart: { ...CHART, title: "A chart that can't be shown" },
      });
    });
    const broken = await screen.findByRole("alert");
    within(broken).getByText("This chart can't be shown");
    screen.getByLabelText("Your question");

    await ask(user, " again");
    const second = await waitFor(() => {
      expect(FakeEventSource.opened).toHaveLength(2);
      return lastStream();
    });
    act(() => {
      second.send(CHART_OUTCOME);
    });
    await screen.findByText("line chart");
    expect(screen.queryByText("This chart can't be shown")).toBeNull();
    console.mockRestore();
  });
});
