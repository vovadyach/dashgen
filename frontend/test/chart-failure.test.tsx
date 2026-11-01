import { act, screen, waitFor } from "@testing-library/react";
import { describe, it, vi } from "vitest";

import { CHART_OUTCOME } from "./fixtures/run.ts";
import { lastStream } from "./helpers/event-source.ts";
import { ask, renderPage, started, stubTheBrowser } from "./helpers/page.tsx";

// The chart's code fails to download, as on a flaky network, or in a tab
// opened before a deploy removed the old file.
vi.mock("../src/components/chart-view.tsx", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

stubTheBrowser();

describe("the page, when the chart's code can't load", () => {
  it("keeps the page and the data table, and says the chart couldn't load", async () => {
    // React reports the error it caught to the console.
    const console = vi.spyOn(globalThis.console, "error");
    console.mockImplementation(() => undefined);
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(CHART_OUTCOME);
    });

    await screen.findByText(/The chart couldn't load/);
    screen.getByRole("heading", { name: CHART_OUTCOME.chart.title });
    screen.getByText("Data table");
    screen.getByLabelText("Your question");
    console.mockRestore();
  });
});
