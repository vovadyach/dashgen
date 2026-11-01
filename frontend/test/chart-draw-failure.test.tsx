import type { Chart } from "@dashgen/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CHART, CHART_OUTCOME, RUN_ID, SECOND_RUN_ID } from "./fixtures/run.ts";
import { FakeEventSource, lastStream } from "./helpers/event-source.ts";
import { ask, renderPage, started, stubTheBrowser } from "./helpers/page.tsx";

// The chart code loads, but one chart throws as it's drawn, like AG Charts
// refusing its options.
vi.mock("../src/components/chart-view.tsx", () => ({
  default: ({ chart }: { chart: Chart }) => {
    if (chart.title === "A chart that can't be drawn") {
      throw new Error("AG Charts couldn't draw it");
    }
    return <p>{`${chart.type} chart`}</p>;
  },
}));

stubTheBrowser();

describe("the page, when a chart fails to draw", () => {
  it("shows the next chart, instead of staying on the failure", async () => {
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
        chart: { ...CHART, title: "A chart that can't be drawn" },
      });
    });
    await screen.findByText(/The chart couldn't load/);

    await ask(user, " again");
    const second = await waitFor(() => {
      expect(FakeEventSource.opened).toHaveLength(2);
      return lastStream();
    });
    act(() => {
      second.send(CHART_OUTCOME);
    });
    await screen.findByText("line chart");
    expect(screen.queryByText(/The chart couldn't load/)).toBeNull();
    console.mockRestore();
  });
});
