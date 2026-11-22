import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { seedOnline } from "../src/health.ts";
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
