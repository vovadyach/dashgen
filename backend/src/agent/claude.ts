import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  type ClientOptions,
} from "@anthropic-ai/sdk";
import { z } from "zod";

import { ModelError } from "./errors.ts";
import {
  ClaudeAnswer,
  type Message,
  type Model,
  type ModelReply,
  ProviderErrorBody,
  type Tool,
  type ToolCall,
} from "./types.ts";
import { checkConversation } from "./validation.ts";

/** Where every request goes, set here so ANTHROPIC_BASE_URL can't send the key elsewhere. */
const CLAUDE_API_URL = "https://api.anthropic.com";

/** Statuses worth one more try: a timeout, a rate limit, an outage, or Claude overloaded (529). */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

/**
 * Why a reply's calls can't be trusted: a safety classifier declined, so the
 * output may not match the tools, or the reply was cut off partway through.
 */
const UNTRUSTED_STOPS = new Set<string>([
  "refusal",
  "max_tokens",
  "model_context_window_exceeded",
]);

export interface ClaudeOptions {
  apiKey: string;
  /** A Claude model, like "claude-haiku-5-5", from AI_MODEL. */
  model: string;
  /** Each request's own limit. The run's 25 seconds come in as the request's signal. */
  timeoutMs?: number;
  /** Includes any thinking, which Claude bills as output (docs/design.md, the daily cap). */
  maxOutputTokens?: number;
  /** Tests pass a fake, so they never reach Anthropic. */
  fetch?: ClientOptions["fetch"];
}

/**
 * The Model, on Claude. Each next() is exactly one request: the SDK's own
 * retries stay off, since every request counts toward a run's limit of model
 * calls, so the agent retries, and counts, itself.
 */
export function createClaudeModel({
  apiKey,
  model,
  timeoutMs = 10_000,
  maxOutputTokens = 512,
  fetch,
}: ClaudeOptions): Model {
  // A key passed here is the client's only credential, so the SDK reads no
  // ANTHROPIC_AUTH_TOKEN or saved profile, and this base URL wins over
  // ANTHROPIC_BASE_URL.
  const client = new Anthropic({
    apiKey,
    baseURL: CLAUDE_API_URL,
    maxRetries: 0,
    timeout: timeoutMs,
    fetch,
  });
  // The SDK still adds ANTHROPIC_CUSTOM_HEADERS's headers after its own key,
  // so a key there would replace this one, and bill another organization. A
  // request's own headers come last, so each request sets the key again.
  const keyHeaders = { authorization: `Bearer ${apiKey}`, "x-api-key": null };

  return {
    name: model,
    next: async ({ system, messages, tools, signal }) => {
      checkConversation(messages);
      // The SDK's own timeout ends once the answer's headers arrive, so a body
      // that stalls would run on to the run's deadline. This one also covers
      // reading the body.
      const timeout = AbortSignal.timeout(timeoutMs);
      let response: Anthropic.Message;
      try {
        response = await client.messages.create(
          {
            model,
            max_tokens: maxOutputTokens,
            system,
            messages: messages.map(toMessageParam),
            tools: tools.map(toTool),
            // Every answer is a tool call, even the last one, so the model
            // never answers in prose and the agent never parses free text.
            // On Claude Haiku 5.5, a forced call also skips thinking.
            tool_choice: { type: "any" },
            output_config: { effort: "low" },
          },
          {
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            headers: keyHeaders,
          },
        );
      } catch (error) {
        throw toModelError(error, signal, timeout);
      }
      // The SDK hands back a body it can't read as JSON as it is, like a
      // proxy's HTML page as text, or an empty 204 as null.
      if (!ClaudeAnswer.safeParse(response).success) {
        throw new ModelError("Claude's answer couldn't be read.", {
          retryable: true,
        });
      }
      return toReply(response);
    },
  };
}

/**
 * A tool as Claude declares it, with its arguments as JSON Schema. Not strict:
 * strict tools take no minimum, maximum or length limits, which DashGen's
 * arguments have. Each tool checks its arguments anyway, and a wrong call goes
 * back to the model as an error to correct.
 */
function toTool(tool: Tool): Anthropic.Tool {
  const schema = z.toJSONSchema(tool.args, { io: "input" });
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: { ...schema, type: "object" },
  };
}

function toMessageParam(message: Message): Anthropic.MessageParam {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.text };
    case "model": {
      // Sent back exactly as it came, as Claude asks, thinking blocks included.
      const { raw } = message.reply;
      if (!isClaudeContent(raw)) {
        throw new Error(
          "This reply came from another model, so it can't go back to Claude.",
        );
      }
      return { role: "assistant", content: raw };
    }
    case "tools":
      // Every result in one message, as Claude asks after calls made together.
      return {
        role: "user",
        content: message.outputs.map((output) => ({
          type: "tool_result",
          tool_use_id: idOf(output.call),
          ...("error" in output
            ? { content: output.error, is_error: true }
            : { content: JSON.stringify(output.result) }),
        })),
      };
  }
}

/** Claude names each call, and needs the name back with its result. */
function idOf(call: ToolCall): string {
  if (call.id === undefined) {
    throw new Error(
      `The ${call.name} call has no ID, so its result can't go back to Claude.`,
    );
  }
  return call.id;
}

function isClaudeContent(
  value: unknown,
): value is Anthropic.ContentBlockParam[] {
  return Array.isArray(value) && value.every(isBlock);
}

function isBlock(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function toReply(response: Anthropic.Message): ModelReply {
  const stop = response.stop_reason ?? "NO_ANSWER";
  const calls: ToolCall[] = UNTRUSTED_STOPS.has(stop)
    ? []
    : response.content.flatMap((block) =>
        block.type === "tool_use"
          ? [{ id: block.id, name: block.name, args: block.input }]
          : [],
      );
  const { usage } = response;
  return {
    calls,
    // A safety classifier declined, so asking again gets the same answer.
    blocked: stop === "refusal",
    text: response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join(""),
    finishReason: stop,
    usage: {
      // DashGen asks for no caching, but cached tokens are input too.
      inputTokens:
        usage.input_tokens +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0),
      // Includes any thinking, which Claude bills as output.
      outputTokens: usage.output_tokens,
    },
    // Only a reply with calls goes back in the conversation, and it needs this.
    raw: calls.length > 0 ? response.content : undefined,
  };
}

function toModelError(
  error: unknown,
  signal: AbortSignal | undefined,
  timeout: AbortSignal,
): unknown {
  // The run's own deadline: not Claude's failure, so it goes up as it is.
  if (signal?.aborted) return error;
  const retryable = (message: string) =>
    new ModelError(message, { retryable: true, cause: error });
  // The request's own timeout, before the headers or while the body was read.
  // A timeout is a connection error too, so it comes first.
  if (timeout.aborted || error instanceof APIConnectionTimeoutError) {
    return retryable("Claude didn't answer in time.");
  }
  if (error instanceof APIConnectionError) {
    return retryable("The connection to Claude failed.");
  }
  if (error instanceof APIError) {
    // The SDK types an error's status and body loosely, so they're checked here.
    const status: unknown = error.status;
    const body: unknown = error.error;
    if (typeof status === "number") {
      return new ModelError(
        `Claude answered ${String(status)}: ${reasonOf(body, error.message)}`,
        { retryable: RETRYABLE_STATUSES.has(status), status, cause: error },
      );
    }
  }
  // Node's fetch fails with these two TypeErrors when the connection fails,
  // before the answer or partway through it.
  if (
    error instanceof TypeError &&
    (error.message === "fetch failed" || error.message === "terminated")
  ) {
    return retryable("The connection to Claude failed.");
  }
  // An answer that isn't the JSON Claude sends, like a cut-off body or a proxy's page.
  if (error instanceof SyntaxError) {
    return retryable("Claude's answer couldn't be read.");
  }
  return error;
}

/** Claude's own reason, from the error's JSON body, or the SDK's message without its status. */
function reasonOf(body: unknown, message: string): string {
  const parsed = ProviderErrorBody.safeParse(body);
  if (parsed.success) return parsed.data.error.message;
  return message.replace(/^\d{3} /, "");
}
