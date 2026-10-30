import { createGeminiModel } from "../../src/agent/gemini.ts";
import type { Message } from "../../src/agent/types.ts";
import { ANSWER, QUESTION_MESSAGE, TOOLS } from "../fixtures/gemini.ts";

export type Answer =
  | { status: number; body: unknown }
  // A body that isn't JSON, like a proxy's error page.
  | { status: number; text: string }
  // Headers arrive, then the connection drops partway through the body.
  | "cut-off"
  // Never answers; only an abort, from the timeout or the run, ends it.
  | "hang"
  | "unreachable";

const JSON_TYPE = { "content-type": "application/json" };

/** Stands in for Google: records each request's URL and body, and gives the next answer. */
export function fakeGemini(...answers: Answer[]) {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetch = (url: unknown, init?: RequestInit) => {
    urls.push(
      url instanceof URL ? url.href : typeof url === "string" ? url : "",
    );
    // The SDK always sends its body as a JSON string.
    const body = typeof init?.body === "string" ? init.body : "{}";
    bodies.push(JSON.parse(body) as Record<string, unknown>);
    const answer = answers.shift() ?? { status: 200, body: ANSWER };
    if (answer === "unreachable") {
      return Promise.reject(new TypeError("fetch failed"));
    }
    if (answer === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        };
        if (init?.signal?.aborted) abort();
        init?.signal?.addEventListener("abort", abort);
      });
    }
    if (answer === "cut-off") {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: JSON_TYPE }),
      );
    }
    return Promise.resolve(
      new Response(
        "text" in answer ? answer.text : JSON.stringify(answer.body),
        {
          status: answer.status,
          headers: JSON_TYPE,
        },
      ),
    );
  };
  const model = createGeminiModel({
    apiKey: "test-key",
    model: "gemini-3.1-flash-lite",
    timeoutMs: 50,
    fetch,
  });
  return { model, urls, bodies };
}

/** A request with these messages: by default, the question alone. */
export const request = (messages: Message[] = [QUESTION_MESSAGE]) => ({
  system: "You are DashGen.",
  messages,
  tools: TOOLS,
});

/** Gemini's answer to a failed request, with this HTTP status. */
export const failure = (status: number) => ({
  status,
  body: { error: { code: status, message: "something failed" } },
});
