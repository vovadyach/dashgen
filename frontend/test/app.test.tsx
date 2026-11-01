import { type Chart, EXAMPLE_QUESTIONS } from "@dashgen/contracts";
import { onlineManager } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
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
} from "./fixtures/run.ts";
import { FakeEventSource, lastStream } from "./helpers/event-source.ts";
import {
  answerAsk,
  ask,
  askButton,
  renderPage,
  started,
  stubTheBrowser,
} from "./helpers/page.tsx";

// AG Charts draws on a canvas, which jsdom doesn't have. The page gets a
// stand-in that says which chart it was given.
vi.mock("../src/components/chart-view.tsx", () => ({
  default: ({ chart }: { chart: Chart }) => <p>{`${chart.type} chart`}</p>,
}));

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
    screen.getByText("list_services · 15 ms · 5 services, 2 metrics");
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

  it("puts the numbers in a data table, with the partial day marked", async () => {
    started();
    await ask(renderPage());
    const stream = await waitFor(lastStream);
    act(() => {
      stream.send(CHART_OUTCOME);
    });
    screen.getByRole("columnheader", { name: "Day (UTC)" });
    screen.getByRole("rowheader", { name: "Oct 25" });
    screen.getByText("28 (partial)");
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
    await ask(renderPage());
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
    const days = screen.getAllByRole("rowheader").map((h) => h.textContent);
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
