import { createClaudeModel } from "../../src/agent/claude.ts";
import { CLAUDE_ANSWER } from "../fixtures/claude.ts";
import { type Answer, fakeFetch } from "./fetch.ts";

/** Stands in for Anthropic: records each request's URL, headers and body, and gives the next answer. */
export function fakeClaude(...answers: Answer[]) {
  const { fetch, urls, headers, bodies } = fakeFetch(CLAUDE_ANSWER, answers);
  const model = createClaudeModel({
    apiKey: "test-key",
    model: "claude-haiku-5-5",
    timeoutMs: 50,
    fetch,
  });
  return { model, urls, headers, bodies };
}

/** Claude's answer to a failed request, with this HTTP status. */
export const claudeFailure = (status: number) => ({
  status,
  body: {
    type: "error",
    error: { type: "api_error", message: "something failed" },
  },
});
