/** What a fake provider answers one request with. */
export type Answer =
  | { status: number; body: unknown }
  // A body that isn't JSON, like a proxy's error page, sent as JSON unless it
  // gives its own type.
  | { status: number; text: string; type?: string }
  // A 204: no body at all.
  | "no-content"
  // Headers arrive, then the connection drops partway through the body: at a
  // 200, or at the status given.
  | "cut-off"
  | { status: number; cutOff: true }
  // Headers arrive, then the body stops partway; only an abort ends it.
  | "stall"
  // Never answers; only an abort, from the timeout or the run, ends it.
  | "hang"
  | "unreachable";

const JSON_TYPE = { "content-type": "application/json" };

/**
 * Stands in for a provider's API, for its SDK's `fetch`: records each
 * request's URL, headers and body, and gives the next answer, or `fallback`
 * once they run out.
 */
export function fakeFetch(fallback: unknown, answers: Answer[]) {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetch = (url: unknown, init?: RequestInit) => {
    urls.push(
      url instanceof URL ? url.href : typeof url === "string" ? url : "",
    );
    headers.push(new Headers(init?.headers));
    // The SDKs always send their body as a JSON string.
    const body = typeof init?.body === "string" ? init.body : "{}";
    bodies.push(JSON.parse(body) as Record<string, unknown>);
    const answer = answers.shift() ?? { status: 200, body: fallback };
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
    if (
      answer === "cut-off" ||
      (typeof answer === "object" && "cutOff" in answer)
    ) {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
      const status = answer === "cut-off" ? 200 : answer.status;
      return Promise.resolve(
        new Response(body, { status, headers: JSON_TYPE }),
      );
    }
    if (answer === "stall") {
      const signal = init?.signal;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":'));
          // As a real fetch does, an abort ends the body's read too.
          signal?.addEventListener("abort", () => {
            controller.error(
              new DOMException("This operation was aborted", "AbortError"),
            );
          });
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: JSON_TYPE }),
      );
    }
    if (answer === "no-content") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(
      new Response(
        "text" in answer ? answer.text : JSON.stringify(answer.body),
        {
          status: answer.status,
          headers:
            "text" in answer && answer.type !== undefined
              ? { "content-type": answer.type }
              : JSON_TYPE,
        },
      ),
    );
  };
  return { fetch, urls, headers, bodies };
}
