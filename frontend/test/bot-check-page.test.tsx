import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { startBotCheck } from "../src/bot-check.ts";
import { QUESTION } from "./fixtures/run.ts";
import { ask, renderPage, started, stubTheBrowser } from "./helpers/page.tsx";
import { fakeTurnstile, settle } from "./helpers/turnstile.ts";

stubTheBrowser();

describe("the page's bot check", () => {
  afterEach(() => {
    delete window.turnstile;
  });

  it("sends Cloudflare's token with the question, and the widget makes a new one", async () => {
    const widget = fakeTurnstile();
    // As if Cloudflare's script had loaded.
    window.turnstile = widget.turnstile;
    startBotCheck();
    await settle();
    widget.issue("token-1");
    const askRoute = started();

    await ask(renderPage());

    await waitFor(() => {
      expect(askRoute).toHaveBeenCalledWith(
        "/api/ask",
        expect.objectContaining({
          body: JSON.stringify({
            question: QUESTION,
            turnstileToken: "token-1",
          }),
        }),
      );
    });
    expect(widget.resets).toEqual(["widget-1"]);
  });
});
