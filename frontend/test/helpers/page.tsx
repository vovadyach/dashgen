import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";

import { App } from "../../src/app.tsx";
import { ThemeProvider } from "../../src/theme.tsx";
import { QUESTION, RUN_ID } from "../fixtures/run.ts";
import { FakeEventSource } from "./event-source.ts";

export type User = ReturnType<typeof userEvent.setup>;

/** How the stubbed backend answers one path: as fetch would, for that path. */
type Route = (url: string, init?: RequestInit) => Promise<Response>;

/** The stubbed backend's answer for each path, which tests set. */
const routes = new Map<string, Route>();

/**
 * Gives each test of the page a FakeEventSource in place of the browser's,
 * and a stubbed fetch, and removes them afterwards. The backend starts
 * healthy: GET /api/health answers ok, and POST /api/ask whatever the test
 * says.
 */
export function stubTheBrowser() {
  beforeEach(() => {
    FakeEventSource.opened = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    routes.clear();
    answerHealth(200, { status: "ok" });
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const route = routes.get(url);
      return route
        ? route(url, init)
        : Promise.reject(new Error(`The test gave ${url} no answer`));
    });
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

/** Makes `path` answer with `reply`. Returns its stub, which sees only that path's requests. */
function answer(path: string, reply: Route) {
  const route = vi.fn(reply);
  routes.set(path, route);
  return route;
}

/** Makes GET /api/health answer with `reply`. */
export function stubHealth(reply: Route) {
  return answer("/api/health", reply);
}

/** Makes GET /api/health answer with `status` and `body`. */
export function answerHealth(status: number, body: unknown) {
  return stubHealth(() => Promise.resolve(Response.json(body, { status })));
}

/** Makes POST /api/ask answer with `reply`. Returns its stub, to check what was asked. */
export function stubAsk(reply: Route) {
  return answer("/api/ask", reply);
}

/** Makes POST /api/ask answer with `status` and `body`. */
export function answerAsk(status: number, body: unknown) {
  return stubAsk(() => Promise.resolve(Response.json(body, { status })));
}

/** Makes POST /api/ask start runs, with these IDs in turn, then RUN_ID. */
export function started(...runIds: string[]) {
  return stubAsk(() =>
    Promise.resolve(
      Response.json({ runId: runIds.shift() ?? RUN_ID }, { status: 202 }),
    ),
  );
}

/** What CloudFront answers, with a 503, to every /api/* request between sessions. */
export const OFFLINE = { status: "offline" };

/** CloudFront's own error page, as when the load balancer is gone: HTML, not the API's JSON. */
export function errorPage(status: number) {
  return new Response(
    `<html><body><h1>${String(status)} ERROR</h1><p>The request could not be satisfied.</p></body></html>`,
    { status, headers: { "content-type": "text/html" } },
  );
}

/** Types `question` and asks it. */
export async function ask(user: User, question = QUESTION) {
  await user.type(screen.getByLabelText("Your question"), question);
  await user.click(screen.getByRole("button", { name: "Ask" }));
}

export const askButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Ask" });
