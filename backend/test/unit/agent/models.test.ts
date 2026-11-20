import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createModel } from "../../../src/agent/models.ts";
import { CLAUDE_ANSWER } from "../../fixtures/claude.ts";
import { ANSWER } from "../../fixtures/gemini.ts";
import { fakeFetch } from "../../helpers/fetch.ts";
import { request } from "../../helpers/model.ts";

describe("createModel", () => {
  it("runs each model on its own provider's API", async () => {
    const cases = [
      {
        name: "claude-haiku-5-5",
        provider: "claude",
        answer: CLAUDE_ANSWER,
        url: "https://api.anthropic.com/",
      },
      {
        name: "gemini-3.1-flash-lite",
        provider: "gemini",
        answer: ANSWER,
        url: "https://generativelanguage.googleapis.com/",
      },
    ] as const;
    for (const { name, provider, answer, url } of cases) {
      const { fetch, urls } = fakeFetch(answer, []);
      const model = createModel({ name, provider, apiKey: "test-key", fetch });

      const reply = await model.next(request());

      assert.equal(model.name, name);
      assert.ok(urls[0]?.startsWith(url), String(urls[0]));
      assert.equal(reply.calls[0]?.name, "list_services");
    }
  });
});
