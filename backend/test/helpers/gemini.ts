import { createGeminiModel } from "../../src/agent/gemini.ts";
import { ANSWER } from "../fixtures/gemini.ts";
import { type Answer, fakeFetch } from "./fetch.ts";

/** Stands in for Google: records each request's URL and body, and gives the next answer. */
export function fakeGemini(...answers: Answer[]) {
  const { fetch, urls, bodies } = fakeFetch(ANSWER, answers);
  const model = createGeminiModel({
    apiKey: "test-key",
    model: "gemini-3.1-flash-lite",
    timeoutMs: 50,
    fetch,
  });
  return { model, urls, bodies };
}

/** Gemini's answer to a failed request, with this HTTP status. */
export const failure = (status: number) => ({
  status,
  body: { error: { code: status, message: "something failed" } },
});
