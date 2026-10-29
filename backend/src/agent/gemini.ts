import {
  ApiError,
  type Content,
  type Fetch,
  type FunctionDeclaration,
  FunctionCallingConfigMode,
  type GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
} from "@google/genai";
import { z } from "zod";

import { ModelError } from "./errors.ts";
import {
  GeminiErrorBody,
  type Message,
  type Model,
  type ModelReply,
  type Tool,
  type ToolCall,
} from "./types.ts";
import { checkConversation } from "./validation.ts";

/** Where every request goes, set here so no GOOGLE_* variable can send the key elsewhere. */
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/";

/** Statuses worth one more try: a timeout, a rate limit, or an outage on Google's side. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface GeminiOptions {
  apiKey: string;
  /** A Gemini 3 model, like "gemini-3.1-flash-lite", from GEMINI_MODEL. */
  model: string;
  /** Each request's own limit. The run's 25 seconds come in as the request's signal. */
  timeoutMs?: number;
  /** Includes thinking, which Gemini bills as output (docs/design.md, the daily cap). */
  maxOutputTokens?: number;
  /** Tests pass a fake, so they never reach Google. */
  fetch?: Fetch;
}

/**
 * The Model, on Gemini. Each next() is exactly one request: the SDK's own
 * retries and its automatic continuation stay off, since every request counts
 * toward a run's limit of model calls, so the agent retries, and counts, itself.
 */
export function createGeminiModel({
  apiKey,
  model,
  timeoutMs = 10_000,
  maxOutputTokens = 512,
  fetch,
}: GeminiOptions): Model {
  // Pinned to the Gemini API: the SDK would otherwise follow GOOGLE_GENAI_USE_VERTEXAI
  // or GOOGLE_GEMINI_BASE_URL from the environment, which only loadConfig reads.
  const ai = new GoogleGenAI({
    apiKey,
    vertexai: false,
    httpOptions: { baseUrl: GEMINI_API_URL, timeout: timeoutMs, fetch },
  });

  return {
    name: model,
    next: async ({ system, messages, tools, signal }) => {
      checkConversation(messages);
      let response: GenerateContentResponse;
      try {
        response = await ai.models.generateContent({
          model,
          contents: messages.map(toContent),
          config: {
            systemInstruction: system,
            tools: [{ functionDeclarations: tools.map(toDeclaration) }],
            // Every answer is a tool call, even the last one, so the model
            // never answers in prose and the agent never parses free text.
            toolConfig: {
              functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
            },
            maxOutputTokens,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            automaticContinuation: false,
            abortSignal: signal,
          },
        });
      } catch (error) {
        throw toModelError(error, signal);
      }
      return toReply(response);
    },
  };
}

/** A tool as Gemini declares it, with its arguments as JSON Schema. */
function toDeclaration(tool: Tool): FunctionDeclaration {
  const schema = z.toJSONSchema(tool.args, { io: "input" });
  delete schema.$schema;
  const hasArgs = Object.keys(schema.properties ?? {}).length > 0;
  return {
    name: tool.name,
    description: tool.description,
    // A tool without arguments leaves them out, as Gemini asks.
    ...(hasArgs ? { parametersJsonSchema: schema } : {}),
  };
}

function toContent(message: Message): Content {
  switch (message.role) {
    case "user":
      return { role: "user", parts: [{ text: message.text }] };
    case "model": {
      // Sent back exactly as it came, with the thought signatures Gemini 3 checks.
      const { raw } = message.reply;
      if (!isContent(raw)) {
        throw new Error(
          "This reply came from another model, so it can't go back to Gemini.",
        );
      }
      return raw;
    }
    case "tools":
      return {
        role: "user",
        parts: message.outputs.map((output) => ({
          functionResponse: {
            id: output.call.id,
            name: output.call.name,
            // Gemini reads "output" as the result and "error" as a failure.
            response:
              "error" in output
                ? { error: output.error }
                : { output: output.result },
          },
        })),
      };
  }
}

function isContent(value: unknown): value is Content {
  return (
    typeof value === "object" &&
    value !== null &&
    "parts" in value &&
    Array.isArray(value.parts)
  );
}

function toReply(response: GenerateContentResponse): ModelReply {
  const candidate = response.candidates?.[0];
  const content = candidate?.content;
  const parts = content?.parts ?? [];
  const calls: ToolCall[] = parts.flatMap(({ functionCall }) =>
    functionCall
      ? [
          {
            ...(functionCall.id ? { id: functionCall.id } : {}),
            name: functionCall.name ?? "",
            args: functionCall.args ?? {},
          },
        ]
      : [],
  );
  const usage = response.usageMetadata;
  return {
    calls,
    // The model's thoughts are parts too, but only for its own use.
    text: parts
      .filter((part) => part.text !== undefined && part.thought !== true)
      .map((part) => part.text)
      .join(""),
    finishReason:
      candidate?.finishReason ??
      response.promptFeedback?.blockReason ??
      "NO_ANSWER",
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      // Gemini bills thinking as output.
      outputTokens:
        (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    },
    // Only a reply with calls goes back in the conversation, and it needs this.
    raw: calls.length > 0 ? content : undefined,
  };
}

function toModelError(
  error: unknown,
  signal: AbortSignal | undefined,
): unknown {
  // The run's own deadline: not Gemini's failure, so it goes up as it is.
  if (signal?.aborted) return error;
  if (error instanceof ApiError) {
    return new ModelError(
      `Gemini answered ${String(error.status)}: ${reasonOf(error)}`,
      {
        retryable: RETRYABLE_STATUSES.has(error.status),
        status: error.status,
        cause: error,
      },
    );
  }
  const retryable = (message: string) =>
    new ModelError(message, { retryable: true, cause: error });
  if (error instanceof Error && error.name === "AbortError") {
    return retryable("Gemini didn't answer in time.");
  }
  // Node's fetch fails with these two TypeErrors when the connection fails,
  // before the answer or partway through it.
  if (
    error instanceof TypeError &&
    (error.message === "fetch failed" || error.message === "terminated")
  ) {
    return retryable("The connection to Gemini failed.");
  }
  // An answer that isn't the JSON Gemini sends, like a cut-off body or a proxy's page.
  if (error instanceof SyntaxError) {
    return retryable("Gemini's answer couldn't be read.");
  }
  return error;
}

/** Gemini's own reason, out of the JSON body the SDK puts in the error's message. */
function reasonOf(error: ApiError): string {
  try {
    const body = GeminiErrorBody.safeParse(JSON.parse(error.message));
    if (body.success) return body.data.error.message;
  } catch {
    // Not JSON: the message is readable as it is.
  }
  return error.message;
}
