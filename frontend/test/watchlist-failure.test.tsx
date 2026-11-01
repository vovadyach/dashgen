import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PINS_KEY } from "../src/pins.ts";
import { CHART } from "./fixtures/run.ts";
import { renderPage, stubTheBrowser } from "./helpers/page.tsx";

// One pinned card throws as it draws, as a chart the page can't handle would.
vi.mock("../src/components/sparkline.tsx", () => ({
  Sparkline: () => {
    throw new Error("A pinned chart that can't be drawn");
  },
}));

stubTheBrowser();

describe("the watchlist, when a pinned chart can't be shown", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps the page, and offers to unpin it", async () => {
    // React reports the error it caught to the console.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    localStorage.setItem(
      PINS_KEY,
      JSON.stringify([{ chart: CHART, pinnedAt: "2026-10-31T10:00:00.000Z" }]),
    );
    const user = renderPage();
    screen.getByText("This pinned chart can't be shown.");
    screen.getByLabelText("Your question");

    await user.click(
      screen.getByRole("button", { name: `Unpin ${CHART.title}` }),
    );
    expect(screen.queryByText("This pinned chart can't be shown.")).toBeNull();
    expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]")).toEqual([]);
  });
});
