import { afterEach, describe, expect, it, vi } from "vitest";

import { createBotCheck, TOKEN_WAIT_MS } from "../src/bot-check.ts";
import { fakeTurnstile, settle } from "./helpers/turnstile.ts";

/** A check on the fake widget, started, with its script loaded. */
async function started() {
  const widget = fakeTurnstile();
  const check = createBotCheck(
    () => Promise.resolve(widget.turnstile),
    "site-key",
  );
  check.start();
  await settle();
  return { widget, check };
}

describe("the bot check", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("renders the widget with the site key, and no hidden form field", async () => {
    const { widget } = await started();
    expect(widget.options()).toMatchObject({
      sitekey: "site-key",
      "response-field": false,
    });
  });

  it("keeps a token ready, and each question takes it, so the widget makes the next", async () => {
    const { widget, check } = await started();
    widget.issue("token-1");
    await expect(check.token()).resolves.toBe("token-1");
    expect(widget.resets).toEqual(["widget-1"]);
  });

  it("waits for the next token when none is ready", async () => {
    const { widget, check } = await started();
    const token = check.token();
    widget.issue("token-2");
    await expect(token).resolves.toBe("token-2");
    expect(widget.resets).toEqual(["widget-1"]);
  });

  it("goes without a token after 5 seconds, so the backend turns the question down, and keeps a late one for the next", async () => {
    vi.useFakeTimers();
    const { widget, check } = await started();
    const token = check.token();
    await vi.advanceTimersByTimeAsync(TOKEN_WAIT_MS);
    await expect(token).resolves.toBeUndefined();
    widget.issue("late");
    await expect(check.token()).resolves.toBe("late");
  });

  it("forgets a token once it expires", async () => {
    const { widget, check } = await started();
    widget.issue("token-1");
    widget.options()?.["expired-callback"]();
    const token = check.token();
    widget.issue("token-2");
    await expect(token).resolves.toBe("token-2");
  });

  it("gives no token, at once, when Cloudflare's script can't load, as with an ad blocker", async () => {
    const check = createBotCheck(
      () => Promise.reject(new Error("blocked")),
      "site-key",
    );
    check.start();
    const waiting = check.token();
    await expect(waiting).resolves.toBeUndefined();
    await expect(check.token()).resolves.toBeUndefined();
  });

  it("gives no token before it starts, as in the page's tests", async () => {
    const check = createBotCheck(
      () => Promise.reject(new Error("never loads")),
      "site-key",
    );
    await expect(check.token()).resolves.toBeUndefined();
  });

  it("makes a question asked before DashGen is known to be online wait for its token", async () => {
    const widget = fakeTurnstile();
    const load = vi.fn(() => Promise.resolve(widget.turnstile));
    const check = createBotCheck(load, "site-key");
    let online: () => void = () => undefined;
    check.start(
      new Promise((resolve) => {
        online = resolve;
      }),
    );

    // As when an example is clicked while the first health check is out.
    const token = check.token();
    await settle();
    expect(load).not.toHaveBeenCalled();

    online();
    await settle();
    widget.issue("token-1");
    await expect(token).resolves.toBe("token-1");
  });
});
