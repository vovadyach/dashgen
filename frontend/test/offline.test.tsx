import { type Chart, EXAMPLE_QUESTIONS } from "@dashgen/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PINS_KEY } from "../src/pins.ts";
import { CHART, CLARIFY, RUN_ID } from "./fixtures/run.ts";
import { lastStream } from "./helpers/event-source.ts";
import { linkTo } from "./helpers/link.ts";
import {
  answerAsk,
  answerHealth,
  ask,
  askButton,
  errorPage,
  OFFLINE,
  renderPage,
  started,
  stubAsk,
  stubHealth,
  stubTheBrowser,
} from "./helpers/page.tsx";

// jsdom has no canvas, so the chart is a stand-in.
vi.mock("../src/components/chart-view.tsx", () => ({
  default: ({ chart }: { chart: Chart }) => <p>{`${chart.type} chart`}</p>,
}));

stubTheBrowser();

const BANNER = "The live demo is offline.";
const banner = () => screen.queryByText(BANNER);
const questionBox = () =>
  screen.getByLabelText<HTMLTextAreaElement>("Your question");

/** The box, its button and the example questions are all off. */
function expectNoWayToAsk() {
  expect(questionBox().disabled).toBe(true);
  expect(askButton().disabled).toBe(true);
  for (const question of EXAMPLE_QUESTIONS) {
    expect(screen.getByTitle<HTMLButtonElement>(question).disabled).toBe(true);
  }
}

/**
 * A few turns of the timers, for the page to finish reacting: TanStack
 * Query passes changes on with them. Long enough that a banner that
 * shouldn't come would be there.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * The tab goes out of view, or comes back, as the browser says with
 * visibilitychange, and the page has its moment to react: TanStack Query
 * handles the event after a few promises settle.
 */
async function showTab(visible: boolean) {
  await act(async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: visible ? "visible" : "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the page, when DashGen is offline", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    localStorage.clear();
    history.replaceState(null, "", "/");
  });

  it("stays on when /api/health answers ok, and checks it only as the page opens", async () => {
    const health = answerHealth(200, { status: "ok" });
    const fetch = started();
    const user = renderPage();
    await ask(user);
    expect(fetch).toHaveBeenCalledOnce();
    expect(banner()).toBeNull();
    // Past the browser's cache, where an old "ok" could outlive the backend.
    expect(health).toHaveBeenCalledExactlyOnceWith(
      "/api/health",
      expect.objectContaining({ cache: "no-store" }),
    );

    // Back from another tab: no new check while DashGen is online.
    await showTab(false);
    await showTab(true);
    expect(health).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "CloudFront's offline 503",
      () => Promise.resolve(Response.json(OFFLINE, { status: 503 })),
    ],
    ["CloudFront's own 502 page", () => Promise.resolve(errorPage(502))],
    ["CloudFront's own 504 page", () => Promise.resolve(errorPage(504))],
    [
      "a 200 with another answer",
      () => Promise.resolve(Response.json({ status: "starting" })),
    ],
    ["no network", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])(
    "shows the banner, and turns off every way to ask, after %s",
    async (_, reply) => {
      stubHealth(reply);
      renderPage();
      await screen.findByText(BANNER);
      expectNoWayToAsk();
    },
  );

  it("turns offline when /api/health doesn't answer within 3 seconds", async () => {
    vi.useFakeTimers();
    try {
      // An answer that never comes: only the page giving up ends it.
      const health = stubHealth(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The page gave up.", "AbortError"));
            });
          }),
      );
      const signal = () => health.mock.calls[0]?.[1]?.signal;
      renderPage();
      await act(() => vi.advanceTimersByTimeAsync(2999));
      expect(signal()?.aborted).toBe(false);
      expect(banner()).toBeNull();

      // At 3 seconds the page gives up, and the banner comes with TanStack
      // Query's next turn of the timers.
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(signal()?.aborted).toBe(true);
      await act(() => vi.advanceTimersByTimeAsync(1));
      screen.getByText(BANNER);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still opens a chart link and pinned charts, which carry their own numbers", async () => {
    answerHealth(503, OFFLINE);
    localStorage.setItem(
      PINS_KEY,
      JSON.stringify([{ chart: CHART, pinnedAt: "2026-10-31T10:00:00.000Z" }]),
    );
    history.replaceState(null, "", await linkTo(CHART));
    const user = renderPage();
    await screen.findByText(BANNER);
    await screen.findByText(
      /Opened from a link, which carries its own numbers\./,
    );

    await user.click(
      screen.getByRole("button", { name: `Open ${CHART.title}` }),
    );
    await screen.findByText(/Pinned .+\. It keeps the numbers it had then\./);
    screen.getByText("line chart");
  });

  it("switches to the banner when a question gets CloudFront's offline 503, as after a session ends", async () => {
    started();
    const user = renderPage();
    await ask(user);
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(CLARIFY);
    });

    // The session ends: CloudFront answers every /api/* request itself.
    const health = answerHealth(503, OFFLINE);
    answerAsk(503, OFFLINE);
    await user.click(screen.getByRole("button", { name: CLARIFY.choices[0] }));
    await screen.findByText(BANNER);
    screen.getByText("The live demo went offline.");
    // The question's own answer said so: the page didn't check again.
    expect(health).not.toHaveBeenCalled();

    // The box holds the choice, and still can't ask it.
    expect(questionBox().value).toBe(CLARIFY.choices[0]);
    expectNoWayToAsk();
    // Nor can the question back, kept under the error, or Try again.
    for (const choice of CLARIFY.choices) {
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: choice })
          .disabled,
      ).toBe(true);
    }
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Try again" })
        .disabled,
    ).toBe(true);
  });

  it("stays on when a late offline 503 answers a question that was stopped and replaced", async () => {
    // Each POST /api/ask answers only when the test says so.
    const replies: ((response: Response) => void)[] = [];
    stubAsk(
      () =>
        new Promise<Response>((resolve) => {
          replies.push(resolve);
        }),
    );
    const user = renderPage();
    await ask(user);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.clear(questionBox());
    await ask(user, "Which service was slowest today?");
    // The second question starts its run.
    await act(async () => {
      replies[1]?.(Response.json({ runId: RUN_ID }, { status: 202 }));
      await settle();
    });
    await waitFor(lastStream);

    // Then the first one's reply comes back late, from an edge server that
    // doesn't have the session yet.
    await act(async () => {
      replies[0]?.(Response.json(OFFLINE, { status: 503 }));
      await settle();
    });
    expect(banner()).toBeNull();
    expect(questionBox().disabled).toBe(false);
  });

  it("keeps the banner when an older check's ok comes back after a question's offline 503", async () => {
    // The check sent as the page opened answers only when the test says so.
    const checks: ((response: Response) => void)[] = [];
    stubHealth(
      () =>
        new Promise<Response>((resolve) => {
          checks.push(resolve);
        }),
    );
    answerAsk(503, OFFLINE);
    await ask(renderPage());
    await screen.findByText(BANNER);

    // That check reached the backend before the session ended. Its "ok"
    // comes back last, and changes nothing.
    await act(async () => {
      checks[0]?.(Response.json({ status: "ok" }));
      await settle();
    });
    screen.getByText(BANNER);
    expectNoWayToAsk();
  });

  it("checks again when its tab comes back into view, and turns back on once a session runs", async () => {
    const first = answerHealth(503, OFFLINE);
    renderPage();
    await screen.findByText(BANNER);

    // The visitor looks at another tab, and a session starts meanwhile.
    await showTab(false);
    expect(first).toHaveBeenCalledOnce();
    const health = answerHealth(200, { status: "ok" });
    await showTab(true);
    await waitFor(() => {
      expect(banner()).toBeNull();
    });
    expect(health).toHaveBeenCalledOnce();
    expect(questionBox().disabled).toBe(false);
  });
});
