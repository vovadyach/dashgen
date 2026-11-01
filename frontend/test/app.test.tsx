import { type Chart, EXAMPLE_QUESTIONS } from "@dashgen/contracts";
import { onlineManager } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHART,
  CHART_OUTCOME,
  CLARIFY,
  DECLINE,
  FAILED_STEP,
  QUESTION,
  RUN_ID,
  SECOND_RUN_ID,
  STEPS,
  TIMEOUT,
  TOO_LARGE_FOR_A_LINK,
} from "./fixtures/run.ts";
import { FakeEventSource, lastStream } from "./helpers/event-source.ts";
import { linkTo } from "./helpers/link.ts";
import {
  answerAsk,
  ask,
  askButton,
  renderPage,
  started,
  stubTheBrowser,
} from "./helpers/page.tsx";

// What the drawn chart does when it's asked to download itself.
const { download } = vi.hoisted(() => ({
  download: vi.fn(() => Promise.resolve()),
}));

// AG Charts draws on a canvas, which jsdom doesn't have. The page gets a
// stand-in that says which chart it was given, and can download itself.
vi.mock("../src/components/chart-view.tsx", async () => {
  const { useImperativeHandle } = await import("react");
  const drawn = { download };
  function ChartStandIn({ chart, ref }: { chart: Chart; ref?: Ref<unknown> }) {
    // Set once, as AG Charts' own React component does.
    useImperativeHandle(ref, () => drawn, []);
    return <p>{`${chart.type} chart`}</p>;
  }
  return { default: ChartStandIn };
});

stubTheBrowser();

describe("the page", () => {
  it("streams the steps as they come, then draws the chart", async () => {
    const fetch = started();
    const user = renderPage();
    await ask(user);
    expect(fetch).toHaveBeenCalledWith("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: QUESTION }),
    });
    const stream = await waitFor(lastStream);
    expect(stream.url).toBe(`/api/runs/${RUN_ID}/events`);

    act(() => {
      stream.send(STEPS[0]);
    });
    // A plain title, then the tool's own name, time and result.
    screen.getByText("Looked up the services and metrics");
    screen.getByText("list_services · 15 ms");
    screen.getByText("5 services, 2 metrics");
    screen.getByText("Choosing the next step…");

    act(() => {
      stream.send(STEPS[1]);
      stream.send(STEPS[2]);
      stream.send(CHART_OUTCOME);
    });
    await screen.findByText("line chart");
    screen.getByRole("heading", { name: CHART.title });
    expect(screen.queryByText("Choosing the next step…")).toBeNull();
    // The steps stay beside the chart.
    screen.getByText("Drew a line chart");
  });

  it("closes the stream as the last event arrives, before the backend ends it, so EventSource never reconnects", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    let closedByHandler = true;
    act(() => {
      closedByHandler = stream.send(STEPS[0]);
    });
    expect(closedByHandler).toBe(false);
    act(() => {
      closedByHandler = stream.send(CHART_OUTCOME);
    });
    expect(closedByHandler).toBe(true);
  });

  it("puts the numbers in a data table, shown with its button, with the partial day marked", async () => {
    started();
    const user = renderPage();
    await ask(user);
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(CHART_OUTCOME);
    });
    const toggle = screen.getByRole("button", { name: "Data table" });
    // Not built at all until it's opened, so typing stays quick.
    expect(document.querySelector("table")).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // First a row per service, summed up: the week's errors add up to 290,
    // the peak was 94 on Oct 29, and today has 28 so far.
    const byService = screen.getByRole("table", { name: "By service" });
    const service = within(byService).getByRole("rowheader", {
      name: "payments-service",
    });
    const cells = within(service.parentElement ?? byService)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    // The trend line is hidden from screen readers, who hear where it went.
    expect(cells).toEqual([
      "26 to 28",
      "290",
      "94, Oct 29",
      "28, Oct 31, so far",
    ]);

    // Then every value, day by day, with today's marked. It's built only
    // once it's opened.
    expect(screen.queryByRole("table", { name: "Day by day" })).toBeNull();
    await user.click(screen.getByText("Day by day", { selector: "summary" }));
    const byDay = await screen.findByRole("table", { name: "Day by day" });
    within(byDay).getByRole("columnheader", { name: "Day (UTC)" });
    within(byDay).getByRole("rowheader", { name: "Oct 25" });
    within(byDay).getByText("28 (partial)");
  });

  it("sums the chart up over it: the week's total, its peak, and the average of its full days", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(CHART_OUTCOME);
    });
    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(
      ["Total", "Peak", "Daily average"],
    );
    // 26 + 36 + 35 + 39 + 94 + 32 + 28, and the first six, without today so far.
    expect(
      screen.getAllByRole("definition").map((value) => value.textContent),
    ).toEqual([
      "290",
      "in 7 days",
      "94",
      "on Oct 29",
      "43.7",
      "over 6 full days",
    ]);
  });

  it("shows a tool call that failed, with its error, and waits for the agent's next step", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(FAILED_STEP);
    });
    screen.getByText(FAILED_STEP.error);
    // Screen readers hear it failed, since the icon is hidden from them.
    screen.getByText("Failed:");
    screen.getByText("Choosing the next step…");
  });

  it("keeps the last answer, dimmed and out of reach, until the next question's answer arrives", async () => {
    started(RUN_ID, SECOND_RUN_ID);
    const user = renderPage();
    await ask(user);
    const first = await waitFor(lastStream);
    act(() => {
      first.send(STEPS[0]);
      first.send(CLARIFY);
    });

    await user.click(screen.getByRole("button", { name: CLARIFY.choices[0] }));
    const second = await waitFor(() => {
      expect(FakeEventSource.opened).toHaveLength(2);
      return lastStream();
    });
    expect(second.url).toBe(`/api/runs/${SECOND_RUN_ID}/events`);
    // New steps, but the old answer stays, inert, so it can't be clicked.
    expect(screen.queryByText("Looked up the services and metrics")).toBeNull();
    screen.getByText("Reading the question…");
    const old = screen.getByText(CLARIFY.message);
    expect(old.closest("[inert]")).not.toBeNull();

    act(() => {
      second.send(CHART_OUTCOME);
    });
    await screen.findByText("line chart");
    expect(screen.queryByText(CLARIFY.message)).toBeNull();
  });

  it("shows the waiting sign over the last chart while the next question runs, until its answer arrives", async () => {
    started(RUN_ID, SECOND_RUN_ID);
    const user = renderPage();
    await ask(user);
    const first = await waitFor(lastStream);
    act(() => {
      first.send(CHART_OUTCOME);
    });
    await screen.findByText("line chart");

    // The same question again, still in the box.
    await user.click(askButton());
    const second = await waitFor(() => {
      expect(FakeEventSource.opened).toHaveLength(2);
      return lastStream();
    });
    const waiting = screen.getByText(
      "The new chart appears here when the agent is done.",
    );
    expect(waiting.closest('[role="status"]')).not.toBeNull();
    // Over the old chart, not in its dimmed, inert part.
    expect(waiting.closest("[inert]")).toBeNull();
    expect(screen.getByText(CHART.title).closest("[inert]")).not.toBeNull();

    act(() => {
      second.send(CLARIFY);
    });
    expect(
      screen.queryByText("The new chart appears here when the agent is done."),
    ).toBeNull();
    screen.getByRole("heading", { name: CLARIFY.message });
  });

  it("brings back the last answer when the next question is stopped", async () => {
    started(RUN_ID, SECOND_RUN_ID);
    const user = renderPage();
    await ask(user);
    const first = await waitFor(lastStream);
    act(() => {
      first.send(CLARIFY);
    });

    await user.click(screen.getByRole("button", { name: CLARIFY.choices[0] }));
    await waitFor(() => {
      expect(FakeEventSource.opened).toHaveLength(2);
    });
    await user.click(screen.getByRole("button", { name: "Stop" }));
    screen.getByRole("heading", { name: CLARIFY.message });
  });

  it("asks the question without its outer spaces, and takes at most 300 characters", async () => {
    const fetch = started();
    const user = renderPage();
    const box = screen.getByLabelText<HTMLTextAreaElement>("Your question");
    await user.click(box);
    await user.paste("x".repeat(301));
    expect(box.value).toHaveLength(300);

    await user.clear(box);
    await ask(user, `  ${QUESTION}  `);
    expect(fetch).toHaveBeenCalledWith(
      "/api/ask",
      expect.objectContaining({ body: JSON.stringify({ question: QUESTION }) }),
    );
  });

  it("can't ask a blank question, or another while one is on its way", async () => {
    started();
    const user = renderPage();
    await user.type(screen.getByLabelText("Your question"), "   ");
    expect(askButton().disabled).toBe(true);

    await ask(user);
    await waitFor(lastStream);
    // Ask turns into Stop, and the examples wait too.
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    screen.getByRole("button", { name: "Stop" });
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "payments-service errors",
      }).disabled,
    ).toBe(true);
  });

  it("stops a question with Stop: the stream closes, the box is free, and the steps so far stay", async () => {
    started();
    const user = renderPage();
    await ask(user);
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(STEPS[0]);
    });

    const stopButton = screen.getByRole("button", { name: "Stop" });
    await user.click(stopButton);
    expect(stream.readyState).toBe(FakeEventSource.CLOSED);
    expect(askButton().disabled).toBe(false);
    // A new element, not the Stop button changed into Ask: in a real browser,
    // a reused one would submit the form as its click finished.
    expect(askButton()).not.toBe(stopButton);
    screen.getByText("Looked up the services and metrics");
    screen.getByText("Stopped.");
    expect(document.activeElement).toBe(screen.getByLabelText("Your question"));
  });

  it("leaves the question running when Esc cancels typing with an input method", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    // Japanese or Chinese input: Esc cancels the characters being composed.
    fireEvent.keyDown(window, { key: "Escape", isComposing: true });
    expect(stream.readyState).not.toBe(FakeEventSource.CLOSED);
    screen.getByRole("button", { name: "Stop" });
  });

  it("stops a question with Esc too, wherever the focus is", async () => {
    started();
    const user = renderPage();
    await ask(user);
    const stream = await waitFor(lastStream);

    await user.keyboard("{Escape}");
    expect(stream.readyState).toBe(FakeEventSource.CLOSED);
    screen.getByRole("button", { name: "Ask" });
  });

  it("asks with Enter, and starts a new line with Shift+Enter", async () => {
    const fetch = started();
    const user = renderPage();
    const box = screen.getByLabelText<HTMLTextAreaElement>("Your question");
    await user.type(box, "Show errors{Shift>}{Enter}{/Shift}this week");
    expect(box.value).toBe("Show errors\nthis week");
    expect(fetch).not.toHaveBeenCalled();

    await user.type(box, "{Enter}");
    expect(fetch).toHaveBeenCalledWith(
      "/api/ask",
      expect.objectContaining({
        body: JSON.stringify({ question: "Show errors\nthis week" }),
      }),
    );
  });

  it("names the sample data, and asks an example question when it's clicked", async () => {
    const fetch = started();
    const user = renderPage();
    screen.getByText("Sample data · 5 services · 30 days");
    screen.getByText(/auth-service, payments-service, checkout-api/);

    // A short label, with the whole question in the box once clicked.
    const example = EXAMPLE_QUESTIONS[3];
    await user.click(
      screen.getByRole("button", { name: "Share of errors, as a pie" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/ask",
      expect.objectContaining({ body: JSON.stringify({ question: example }) }),
    );
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Your question").value,
    ).toBe(example);
  });

  it("shows no steps for a question that fails before its first one", async () => {
    answerAsk(429, {
      error: { code: "rate_limited", message: "Rate limit exceeded." },
    });
    await ask(renderPage());
    await screen.findByText("Rate limit exceeded.");
    expect(screen.queryByText(/steps?\b/i)).toBeNull();
  });

  it("lists the days in time order in the table, even when the first service lacks one", async () => {
    started();
    const user = renderPage();
    await ask(user);
    const stream = await waitFor(lastStream);
    const day = (date: number) =>
      new Date(Date.UTC(2026, 9, date)).toISOString();
    act(() => {
      stream.send({
        ...CHART_OUTCOME,
        chart: {
          ...CHART,
          series: [
            {
              name: "payments-service",
              points: [
                { x: day(25), y: 26 },
                { x: day(27), y: 35 },
              ],
            },
            {
              name: "checkout-api",
              points: [
                { x: day(25), y: 48 },
                { x: day(26), y: 51 },
                { x: day(27), y: 40 },
              ],
            },
          ],
        },
      });
    });
    await user.click(screen.getByRole("button", { name: "Data table" }));
    await user.click(screen.getByText("Day by day", { selector: "summary" }));
    const days = within(
      await screen.findByRole("table", { name: "Day by day" }),
    )
      .getAllByRole("rowheader")
      .map((h) => h.textContent);
    expect(days).toEqual(["Oct 25", "Oct 26", "Oct 27"]);
  });

  it("asks a clarifying choice when it's clicked, and puts it in the box", async () => {
    const fetch = started();
    const user = renderPage();
    await ask(user);
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(CLARIFY);
    });
    screen.getByRole("heading", { name: CLARIFY.message });

    const choice = CLARIFY.choices[1];
    await user.click(screen.getByRole("button", { name: choice }));
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/ask",
      expect.objectContaining({ body: JSON.stringify({ question: choice }) }),
    );
    const box = screen.getByLabelText<HTMLTextAreaElement>("Your question");
    expect(box.value).toBe(choice);
    // The clicked button went away with its card, so focus is in the box,
    // not lost for keyboard users.
    expect(document.activeElement).toBe(box);
  });

  it("offers example questions when it declines", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(DECLINE);
    });
    screen.getByRole("heading", { name: DECLINE.message });
    screen.getByRole("button", { name: DECLINE.examples[0] });
  });

  it("keeps the last answer under the error when the next question fails, labeled and still usable", async () => {
    started(RUN_ID, SECOND_RUN_ID);
    const user = renderPage();
    await ask(user);
    const first = await waitFor(lastStream);
    act(() => {
      first.send(CHART_OUTCOME);
    });
    await screen.findByText("line chart");

    await user.click(askButton());
    const second = await waitFor(() => {
      expect(FakeEventSource.opened).toHaveLength(2);
      return lastStream();
    });
    act(() => {
      second.send(TIMEOUT);
    });
    screen.getByText(TIMEOUT.message);
    screen.getByText("Your last answer");
    const title = screen.getByRole("heading", { name: CHART.title });
    expect(title.closest("[inert]")).toBeNull();
    screen.getByRole("button", { name: "Pin" });
  });

  it("follows only the current question, when the one before was stopped before its run started", async () => {
    // Each POST /api/ask answers only when the test says so.
    const replies: ((runId: string) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            replies.push((runId) => {
              resolve(Response.json({ runId }, { status: 202 }));
            });
          }),
      ),
    );
    const user = renderPage();
    await ask(user);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.clear(screen.getByLabelText("Your question"));
    await ask(user, "Which service was slowest today?");

    // The stopped question's run ID comes back late, while the new one waits
    // for its own. It's not the new question's run, so no stream opens. A
    // timer's turn lets the reply's whole chain of promises settle first.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    await act(async () => {
      replies[0]?.(RUN_ID);
      await settle();
    });
    expect(FakeEventSource.opened).toHaveLength(0);

    await act(async () => {
      replies[1]?.(SECOND_RUN_ID);
      await settle();
    });
    const stream = await waitFor(lastStream);
    expect(stream.url).toBe(`/api/runs/${SECOND_RUN_ID}/events`);
    expect(FakeEventSource.opened).toHaveLength(1);
  });

  it("shows the stream's error, and asks the same question again on Try again", async () => {
    const fetch = started();
    const user = renderPage();
    await ask(user);
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(STEPS[0]);
      stream.send(TIMEOUT);
    });
    screen.getByRole("alert");
    screen.getByText(TIMEOUT.message);
    screen.getByText("Looked up the services and metrics");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Your question"));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/ask",
      expect.objectContaining({
        body: JSON.stringify({ question: QUESTION }),
      }),
    );
  });

  it("keeps waiting while EventSource reconnects after a dropped connection", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(STEPS[0]);
      stream.drop();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    screen.getByText("Choosing the next step…");

    act(() => {
      stream.send(CHART_OUTCOME);
    });
    await screen.findByText("line chart");
  });

  it("says the answer was interrupted when the stream gives up", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(STEPS[0]);
      stream.fail();
    });
    screen.getByText("The answer was interrupted. Ask the question again.");
    screen.getByText("Looked up the services and metrics");
  });

  it("shows the API's message when a question can't start, and opens no stream", async () => {
    const message = "Rate limit exceeded, try again later.";
    answerAsk(429, { error: { code: "rate_limited", message } });
    await ask(renderPage());
    await screen.findByText(message);
    expect(FakeEventSource.opened).toEqual([]);
  });

  it.each([
    ["invalid_question", 422, "The question must be 1 to 300 characters."],
    ["rate_limited", 429, "Rate limit exceeded, try again later."],
  ])(
    "offers no Try again after %s, which would fail the same way",
    async (code, status, message) => {
      answerAsk(status, { error: { code, message } });
      await ask(renderPage());
      await screen.findByText(message);
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    },
  );

  it("fails at once when the browser says it's offline, instead of holding the question to send later", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", fetch);
    onlineManager.setOnline(false);
    try {
      await ask(renderPage());
      await screen.findByText(
        "Can't reach DashGen. Check your connection, and try again.",
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("says it can't reach DashGen when the request itself fails, and offers Try again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await ask(renderPage());
    await screen.findByText(
      "Can't reach DashGen. Check your connection, and try again.",
    );
    screen.getByRole("button", { name: "Try again" });
  });

  it("says DashGen isn't answering when the reply isn't the API's", async () => {
    answerAsk(503, { status: "offline" });
    await ask(renderPage());
    await screen.findByText("DashGen isn't answering. Try again in a moment.");
  });
});

describe("a chart's pin, link and download", () => {
  afterEach(() => {
    localStorage.clear();
    history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  /** Asks the question, and gets `chart`. */
  async function chartPage(chart = CHART) {
    const fetch = started();
    const user = renderPage();
    await ask(user);
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send({ ...CHART_OUTCOME, chart });
    });
    await screen.findByText("line chart");
    return { user, fetch };
  }

  /** Saves a pin of CHART in the browser, as an earlier visit would have. */
  const pinEarlier = () => {
    localStorage.setItem(
      "pins",
      JSON.stringify([{ chart: CHART, pinnedAt: "2026-10-31T10:00:00.000Z" }]),
    );
  };

  const watchlist = () =>
    screen.queryByRole("region", { name: "Your watchlist" });

  it("pins the chart to the watchlist, keeps it after a reload, and opens it again with no run", async () => {
    const { user, fetch } = await chartPage();
    expect(watchlist()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Pin" }));
    screen.getByRole("button", { name: "Unpin" });
    const pinned = screen.getByRole("region", { name: "Your watchlist" });
    // The week's errors add up: 26 + 36 + 35 + 39 + 94 + 32 + 28.
    within(pinned).getByText("290");
    within(pinned).getByText("total");

    // A reload: the new page reads the pin back from the browser.
    cleanup();
    const reloaded = renderPage();
    const open = screen.getByRole("button", {
      name: `Open ${CHART.title}`,
      description: "290 total",
    });
    await reloaded.click(open);
    await screen.findByText("line chart");
    screen.getByRole("heading", { name: CHART.title });
    screen.getByText(/Pinned .+\. It keeps the numbers it had then\./);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.opened).toHaveLength(1);
  });

  it("unpins from the watchlist", async () => {
    const { user } = await chartPage();
    await user.click(screen.getByRole("button", { name: "Pin" }));
    await user.click(
      screen.getByRole("button", { name: `Unpin ${CHART.title}` }),
    );
    expect(watchlist()).toBeNull();
    screen.getByRole("button", { name: "Pin" });
    expect(localStorage.getItem("pins")).toBe("[]");
  });

  it("still pins while the page is open when the browser blocks storage, and says the pins won't last", async () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    const { user } = await chartPage();
    await user.click(screen.getByRole("button", { name: "Pin" }));
    const pinned = screen.getByRole("region", { name: "Your watchlist" });
    within(pinned).getByText(
      "Your browser isn't saving pins, so your changes last only until you leave the page.",
    );
    expect(screen.queryByText(/Saved in this browser only/)).toBeNull();
  });

  it("keeps saying the pins won't last when the browser can't save the last one's unpinning", async () => {
    pinEarlier();
    // The browser reads its storage, but can't write to it, as when it's full.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException(
        "The quota has been exceeded.",
        "QuotaExceededError",
      );
    });
    const user = renderPage();
    await user.click(
      screen.getByRole("button", { name: `Unpin ${CHART.title}` }),
    );
    const section = screen.getByRole("region", { name: "Your watchlist" });
    within(section).getByText(
      "Your browser isn't saving pins, so your changes last only until you leave the page.",
    );
    expect(within(section).queryByRole("listitem")).toBeNull();
  });

  const copyButton = async () => {
    const copy = screen.getByRole<HTMLButtonElement>("button", {
      name: "Copy link",
    });
    // The link is made as the chart shows, and the button waits for it.
    await waitFor(() => {
      expect(copy.disabled).toBe(false);
    });
    return copy;
  };

  it("copies the link within the click itself, as Safari and iOS require", async () => {
    await chartPage();
    const copy = await copyButton();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    fireEvent.click(copy);
    // Called before the click handler returned, with nothing awaited first.
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/#chart="));
    await screen.findByText("Link copied.");
  });

  it("says when a chart is too large to share as a link", async () => {
    await chartPage(TOO_LARGE_FOR_A_LINK);
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    fireEvent.click(await copyButton());
    await screen.findByText("This chart is too large to share as a link.");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("says when the browser can't make a link, not that the chart is too large", async () => {
    // As in a browser without the compression links use.
    vi.stubGlobal("CompressionStream", undefined);
    await chartPage();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    fireEvent.click(await copyButton());
    await screen.findByText("Couldn't make a link to this chart.");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("says when the link can't be copied", async () => {
    await chartPage();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new DOMException("Write permission denied.", "NotAllowedError"),
    );
    fireEvent.click(await copyButton());
    await screen.findByText("Couldn't copy the link.");
  });

  it("keeps saying a chart came from a link after it's pinned, and opened again", async () => {
    history.replaceState(null, "", await linkTo(CHART));
    const user = renderPage();
    await screen.findByText(
      /Opened from a link, which carries its own numbers\./,
    );
    await user.click(screen.getByRole("button", { name: "Pin" }));

    // A reload, which opens the pin.
    cleanup();
    const reloaded = renderPage();
    await reloaded.click(
      screen.getByRole("button", { name: `Open ${CHART.title}` }),
    );
    await screen.findByText(
      /Pinned .+, from a link, which carries its own numbers\./,
    );
  });

  it("keeps saying a chart came from a link while the next question runs, and after it's stopped", async () => {
    started();
    history.replaceState(null, "", await linkTo(CHART));
    const user = renderPage();
    const note = /Opened from a link, which carries its own numbers\./;
    await screen.findByText(note);

    await ask(user);
    await waitFor(lastStream);
    screen.getByText(note);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    screen.getByText(note);
  });

  it("opens a link pasted while a question runs, which stops watching the question", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    location.hash = new URL(await linkTo(CHART)).hash;
    await screen.findByText(
      /Opened from a link, which carries its own numbers\./,
    );
    expect(stream.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("copies a link that opens the chart on a new page, with no run", async () => {
    const { user, fetch } = await chartPage();
    await user.click(await copyButton());
    await screen.findByText("Link copied.");
    const link = await navigator.clipboard.readText();
    expect(link.startsWith(`${location.origin}/#chart=`)).toBe(true);

    cleanup();
    history.replaceState(null, "", link);
    renderPage();
    await screen.findByText("line chart");
    screen.getByRole("heading", { name: CHART.title });
    screen.getByText(/Opened from a link, which carries its own numbers\./);
    // The address goes back to the page's own, so a reload starts fresh.
    expect(location.hash).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("says so when a link can't be read, until the next question", async () => {
    started();
    history.replaceState(null, "", "/#chart=not-a-chart");
    const user = renderPage();
    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toMatch(/This chart link couldn't be opened/);
    expect(location.hash).toBe("");
    expect(screen.queryByRole("heading", { name: CHART.title })).toBeNull();

    await ask(user);
    expect(screen.queryByText(/This chart link couldn't be opened/)).toBeNull();
  });

  it("draws a pinned chart's mini chart again when the pointer comes onto its card", async () => {
    pinEarlier();
    const user = renderPage();
    const card = screen.getByRole("button", { name: `Open ${CHART.title}` });
    // New elements, so their animation starts over.
    const line = () => card.querySelector(".sparkline-line");
    const before = line();
    expect(before).not.toBeNull();
    await user.hover(card);
    expect(line()).not.toBe(before);
  });

  it("downloads the chart as a PNG named after its title", async () => {
    const { user } = await chartPage();
    await user.click(screen.getByRole("button", { name: "Download PNG" }));
    expect(download).toHaveBeenCalledWith({
      fileName: "errors-for-payments-service-last-7-days.png",
    });
  });

  it("downloads the chart's numbers as a CSV file named after its title", async () => {
    // jsdom makes no URLs for files, so the test keeps the file it's given.
    const files: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (file: Blob) => {
        files.push(file);
        return "blob:dashgen/csv";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => undefined,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    try {
      const { user } = await chartPage();
      await user.click(screen.getByRole("button", { name: "Download CSV" }));

      const link = click.mock.contexts[0] as HTMLAnchorElement;
      expect(link.download).toBe("errors-for-payments-service-last-7-days.csv");
      expect(link.href).toBe("blob:dashgen/csv");
      // The link only lives for its click.
      expect(link.isConnected).toBe(false);

      const [file] = files;
      expect(file?.type).toBe("text/csv;charset=utf-8");
      const bytes = new Uint8Array((await file?.arrayBuffer()) ?? []);
      // A byte order mark, so Excel reads it as UTF-8.
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const lines = new TextDecoder().decode(bytes).split("\r\n");
      expect(lines[0]).toBe("day (UTC),payments-service,partial");
      expect(lines.at(-1)).toBe("2026-10-31,28,yes");
    } finally {
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });
});

describe("the theme toggle", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("switches the theme, and remembers the choice", async () => {
    const user = renderPage();
    await user.click(
      screen.getByRole("button", { name: "Use the dark theme" }),
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
    screen.getByRole("button", { name: "Use the light theme" });
  });
});
