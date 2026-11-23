import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markOffline, onceOnline, seedOnline } from "../src/health.ts";
import {
  answerHealth,
  OFFLINE,
  renderPage,
  stubTheBrowser,
} from "./helpers/page.tsx";

stubTheBrowser();

const BANNER = "The live demo is offline.";
/** What index.html's check keeps from CloudFront's answer between sessions. */
const OFFLINE_ANSWER = { status: 503, body: OFFLINE };

/** The page as main.tsx starts it: seedOnline(), then the first render. */
function startPage() {
  const client = new QueryClient();
  seedOnline(client);
  return renderPage(client);
}

describe("the health check index.html starts while the code downloads", () => {
  afterEach(() => {
    delete window.dashgenHealth;
  });

  it("puts the offline banner in the page's first render, when it has answered", () => {
    window.dashgenHealth = {
      check: Promise.resolve(OFFLINE_ANSWER),
      answer: OFFLINE_ANSWER,
    };
    const health = answerHealth(200, { status: "ok" });
    startPage();
    // At once, with nothing to wait for: it never pushes the page down.
    screen.getByText(BANNER);
    expect(health).not.toHaveBeenCalled();
  });

  it("is the page's first check, when it answers after the code has run", async () => {
    let answer: (answer: typeof OFFLINE_ANSWER) => void = () => undefined;
    window.dashgenHealth = {
      check: new Promise((resolve) => {
        answer = resolve;
      }),
    };
    const health = answerHealth(200, { status: "ok" });
    startPage();
    // Online until it answers, as before.
    expect(screen.queryByText(BANNER)).toBeNull();
    answer(OFFLINE_ANSWER);
    await screen.findByText(BANNER);
    expect(health).not.toHaveBeenCalled();
  });

  it("leaves the page online when DashGen is up", () => {
    const up = { status: 200, body: { status: "ok" } };
    window.dashgenHealth = { check: Promise.resolve(up), answer: up };
    const health = answerHealth(200, { status: "ok" });
    startPage();
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(health).not.toHaveBeenCalled();
  });
});

describe("onceOnline", () => {
  const UP = { status: 200, body: { status: "ok" } };
  /** A check's answer, as index.html's gives the page. */
  const answered = (client: QueryClient, answer: typeof UP) => {
    window.dashgenHealth = { check: Promise.resolve(answer), answer };
    seedOnline(client);
  };
  // TanStack Query tells its listeners a moment later.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  afterEach(() => {
    delete window.dashgenHealth;
  });

  it("resolves once a check finds DashGen online, never while it's offline", async () => {
    const client = new QueryClient();
    const online = vi.fn();
    void onceOnline(client).then(online);

    answered(client, OFFLINE_ANSWER);
    await tick();
    expect(online).not.toHaveBeenCalled();

    answered(client, UP);
    await tick();
    expect(online).toHaveBeenCalledTimes(1);

    // It stops listening once it has.
    await markOffline(client);
    answered(client, UP);
    await tick();
    expect(online).toHaveBeenCalledTimes(1);
  });

  it("resolves at once when a check has already found DashGen online", async () => {
    const client = new QueryClient();
    answered(client, UP);
    await expect(onceOnline(client)).resolves.toBeUndefined();
  });
});
