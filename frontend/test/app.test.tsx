import type { Chart } from "@dashgen/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app.tsx";
import { ThemeProvider } from "../src/theme.tsx";
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

// AG Charts draws on a canvas, which jsdom doesn't have. The page gets a
// stand-in that says which chart it was given.
vi.mock("../src/components/chart-view.tsx", () => ({
  default: ({ chart }: { chart: Chart }) => <p>{`${chart.type} chart`}</p>,
}));

type User = ReturnType<typeof userEvent.setup>;

/** The page, with what main.tsx gives it. */
function renderPage(): User {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** Makes POST /api/ask answer with `status` and `body`. */
function answerAsk(status: number, body: unknown) {
  const fetch = vi.fn(() => Promise.resolve(Response.json(body, { status })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Makes POST /api/ask start runs, with these IDs in turn, then RUN_ID. */
function started(...runIds: string[]) {
  const fetch = vi.fn(() =>
    Promise.resolve(
      Response.json({ runId: runIds.shift() ?? RUN_ID }, { status: 202 }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Types `question` and asks it. */
async function ask(user: User, question = QUESTION) {
  await user.type(screen.getByLabelText("Your question"), question);
  await user.click(screen.getByRole("button", { name: "Ask" }));
}

const askButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Ask" });

beforeEach(() => {
  FakeEventSource.opened = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    screen.getByText("list_services");
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

  it("starts afresh with each question: the old steps and answer go, and a new stream opens", async () => {
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
    expect(screen.queryByText("list_services")).toBeNull();
    expect(screen.queryByRole("heading", { name: CLARIFY.message })).toBeNull();
    screen.getByText("Reading the question…");
  });

  it("asks the question without its outer spaces, and takes at most 300 characters", async () => {
    const fetch = started();
    const user = renderPage();
    const box = screen.getByLabelText<HTMLInputElement>("Your question");
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

  it("can't ask while a question is on its way, or ask a blank one", async () => {
    started();
    const user = renderPage();
    await user.type(screen.getByLabelText("Your question"), "   ");
    expect(askButton().disabled).toBe(true);

    await ask(user);
    await waitFor(lastStream);
    expect(askButton().disabled).toBe(true);
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
    expect(screen.getByLabelText<HTMLInputElement>("Your question").value).toBe(
      choice,
    );
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
    screen.getByText("list_services");

    await user.click(screen.getByRole("button", { name: "Try again" }));
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
    screen.getByText("list_services");
  });

  it("shows the API's message when a question can't start, and opens no stream", async () => {
    const message = "Rate limit exceeded, try again later.";
    answerAsk(429, { error: { code: "rate_limited", message } });
    await ask(renderPage());
    await screen.findByText(message);
    expect(FakeEventSource.opened).toEqual([]);
  });

  it("offers no Try again for a question the backend refused as invalid", async () => {
    const message = "The question must be 1 to 300 characters.";
    answerAsk(422, { error: { code: "invalid_question", message } });
    await ask(renderPage());
    await screen.findByText(message);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
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
