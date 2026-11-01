import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";

import { App } from "../../src/app.tsx";
import { ThemeProvider } from "../../src/theme.tsx";
import { QUESTION, RUN_ID } from "../fixtures/run.ts";
import { FakeEventSource } from "./event-source.ts";

export type User = ReturnType<typeof userEvent.setup>;

/**
 * Gives each test of the page a FakeEventSource in place of the browser's,
 * and removes it and any stubbed `fetch` afterwards.
 */
export function stubTheBrowser() {
  beforeEach(() => {
    FakeEventSource.opened = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

/** The page, with what main.tsx gives it. */
export function renderPage(): User {
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
export function answerAsk(status: number, body: unknown) {
  const fetch = vi.fn(() => Promise.resolve(Response.json(body, { status })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Makes POST /api/ask start runs, with these IDs in turn, then RUN_ID. */
export function started(...runIds: string[]) {
  const fetch = vi.fn(() =>
    Promise.resolve(
      Response.json({ runId: runIds.shift() ?? RUN_ID }, { status: 202 }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Types `question` and asks it. */
export async function ask(user: User, question = QUESTION) {
  await user.type(screen.getByLabelText("Your question"), question);
  await user.click(screen.getByRole("button", { name: "Ask" }));
}

export const askButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Ask" });
