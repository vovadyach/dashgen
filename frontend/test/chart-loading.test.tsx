import type { Chart } from "@dashgen/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CHART, CHART_OUTCOME } from "./fixtures/run.ts";
import { lastStream } from "./helpers/event-source.ts";
import { ask, renderPage, started, stubTheBrowser } from "./helpers/page.tsx";

// The chart's code downloads slowly, as on a phone: it's there when the test
// says so.
const download = vi.hoisted(() => Promise.withResolvers<undefined>());

vi.mock("../src/components/chart-view.tsx", async () => {
  await download.promise;
  return {
    default: ({ chart }: { chart: Chart }) => <p>{`${chart.type} chart`}</p>,
  };
});

stubTheBrowser();

describe("the page, while the chart's code downloads", () => {
  it("shows the chart drawing itself, and says it's loading, until the chart is there", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(CHART_OUTCOME);
    });

    // The card and its numbers are there already, from the chart's data.
    screen.getByRole("heading", { name: CHART.title });
    screen.getByText("Daily average");
    const loading = screen.getByText("Loading the chart…");
    expect(loading.getAttribute("role")).toBe("status");

    download.resolve(undefined);
    await screen.findByText("line chart");
    expect(screen.queryByText("Loading the chart…")).toBeNull();
  });
});
