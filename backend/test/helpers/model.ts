import type { Model, ModelReply, ModelRequest } from "../../src/agent/types.ts";
import { checkConversation } from "../../src/agent/validation.ts";

/** A script step: a reply, an Error to throw, or "hang" until the run's deadline aborts. */
export type Step = ModelReply | Error | "hang";

/**
 * A model that answers from a script and records each request, so agent tests
 * never call Gemini. It keeps the real model's rules: the same checks on the
 * conversation, and an AbortError when the request's signal fires.
 */
export function fakeModel(
  script: Step[],
): Model & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const remaining = [...script];
  return {
    name: "fake-model",
    requests,
    next: async (request) => {
      // A copy: the loop keeps adding to the same list of messages.
      requests.push({ ...request, messages: [...request.messages] });
      checkConversation(request.messages);
      const step = remaining.shift();
      if (step === undefined)
        throw new Error("The fake model's script ran out.");
      if (step === "hang") return await untilAborted(request.signal);
      if (request.signal?.aborted) throw abortError();
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

function abortError(): DOMException {
  return new DOMException("This operation was aborted", "AbortError");
}

/** Never resolves; rejects as fetch does when the signal fires. */
function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal)
      throw new Error('A "hang" step needs a request with a signal.');
    if (signal.aborted) reject(abortError());
    signal.addEventListener("abort", () => {
      reject(abortError());
    });
  });
}

/** A reply that calls these tools, several at once if given several, with typical token counts. */
export function reply(
  ...calls: [name: string, args?: Record<string, unknown>][]
): ModelReply {
  return {
    calls: calls.map(([name, args = {}], i) => ({
      id: `call-${String(i + 1)}`,
      name,
      args,
    })),
    text: "",
    finishReason: "STOP",
    usage: { inputTokens: 2_000, outputTokens: 60 },
  };
}

/** A reply in which the model called no tool, which Gemini can send even in its ANY mode. */
export function emptyReply(
  finishReason = "MALFORMED_FUNCTION_CALL",
): ModelReply {
  return {
    calls: [],
    text: "",
    finishReason,
    usage: { inputTokens: 2_000, outputTokens: 0 },
  };
}
