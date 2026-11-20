import {
  AskRequest,
  Chart,
  ChartType,
  MetricsQuery,
  type Outcome,
  type RunEvent,
  type ToolStep,
} from "@dashgen/contracts";
import { z } from "zod";

// Each tool's arguments. The descriptions are written for the model, which reads
// them with the tool's own description to decide what to send. The objects are
// strict: a misspelled argument is an error the model can fix, never silently
// dropped, which would quietly change the chart.

export const ListServicesArgs = z.strictObject({});

export const QueryMetricsArgs = z.strictObject({
  service: MetricsQuery.shape.service.describe(
    "A service name from list_services.",
  ),
  metric: MetricsQuery.shape.metric.describe(
    "A metric name from list_services.",
  ),
  days: MetricsQuery.shape.days.describe(
    "How far back, 1 to 30. Daily buckets cover that many UTC days, today included; hourly buckets cover the last days × 24 hours. For today or the last day, use 1 with hourly buckets, and say 'last 24 hours' in the title. Use 7 when the question gives no range.",
  ),
  bucket: MetricsQuery.shape.bucket.describe(
    "hour or day. Leave it out for hourly buckets up to 2 days and daily beyond.",
  ),
});

/** The summary statistic that turns each service's series into one number, to compare services. */
export const Aggregation = z.enum(["avg", "max", "min", "total", "latest"]);
export type Aggregation = z.infer<typeof Aggregation>;

/** create_chart's arguments. The model names query results; it never sends numbers. */
export const CreateChartArgs = z.strictObject({
  type: ChartType.describe(
    "line or bar over time; bar or pie to compare services.",
  ),
  sources: z
    .array(z.string())
    .min(1)
    .max(10)
    .describe("Result IDs from query_metrics, like q1, one per service."),
  title: Chart.shape.title.describe(
    'What is plotted, like "Errors per day, payments-service, last 7 days". Never a conclusion.',
  ),
  aggregation: Aggregation.optional().describe(
    "Only to compare services, as one number each: total (for metrics that add up), avg, max, min or latest, over the hours of each result. Leave it out for a chart over time.",
  ),
});
export type CreateChartArgs = z.infer<typeof CreateChartArgs>;

export const ClarifyArgs = z.strictObject({
  message: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("One short sentence saying what is unclear."),
  choices: z
    .array(AskRequest.shape.question)
    .min(2)
    .max(4)
    .describe(
      "2 to 4 complete questions the visitor can pick from, each one you could answer.",
    ),
});

export const DeclineArgs = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "One short, friendly sentence saying what DashGen can't do here.",
    ),
});

/**
 * What a tool call gives back: a result for the model, or the run's outcome,
 * which ends it. `step` is a short line for the visitor's steps panel.
 */
export type ToolResult =
  | { done: false; result: Record<string, unknown>; step: string }
  | { done: true; outcome: Outcome; step: string };

export interface Tool {
  name: string;
  /** What the tool does and doesn't handle. The model reads it to choose. */
  description: string;
  args: z.ZodType;
  /**
   * Checks the model's arguments against `args`, then runs. Always a promise:
   * a wrong call rejects with a ToolError, for the model to correct, and never
   * throws on the spot. Run a reply's calls in order, one at a time, so a later
   * call can use an earlier one's result, like a chart of the queries before it.
   */
  call: (input: unknown) => Promise<ToolResult>;
}

// The model, behind an interface: the agent loop talks to this, so tests pass
// a scripted fake and never call Gemini or Claude. Each provider has an
// adapter that turns these types into its own requests (gemini.ts, claude.ts).

/**
 * A tool call the model asked for, sent back with its result. Gemini may give
 * it an `id`; Claude always does, and needs it back.
 */
export interface ToolCall {
  id?: string;
  name: string;
  args: unknown;
}

/** What one tool call returned, for the model: its result, or the ToolError's message. */
export type ToolOutput =
  | { call: ToolCall; result: Record<string, unknown> }
  | { call: ToolCall; error: string };

/** The tokens of one request, or of a whole run. Both providers bill thinking as output. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** The model's answer to one request. */
export interface ModelReply {
  /**
   * The tools it asked for, often several at once. Empty when the model called
   * none: a safety block, a malformed call, or no tokens left. Such a reply
   * never goes back in the conversation; docs/design.md (the agent's tools)
   * says what the loop does instead.
   */
  calls: ToolCall[];
  /** A safety filter stopped the question or the answer, so asking again gets the same block. */
  blocked: boolean;
  /** Any text beside the calls; usually empty, since every answer must be a tool call. */
  text: string;
  /** Why the model stopped, as the provider says it, like Gemini's "STOP" or Claude's "tool_use". */
  finishReason: string;
  usage: Usage;
  /**
   * The reply exactly as the provider sent it, whenever it has calls. Put the
   * whole ModelReply back in the conversation: Gemini 3 checks the signatures
   * inside it on the next request, and Claude its thinking blocks.
   */
  raw?: unknown;
}

/** The conversation so far, oldest first. */
export type Message =
  | { role: "user"; text: string }
  | { role: "model"; reply: ModelReply }
  | { role: "tools"; outputs: ToolOutput[] };

export interface ModelRequest {
  /** The instructions: what DashGen is and the rules it follows. */
  system: string;
  messages: Message[];
  tools: Tool[];
  /** Aborts the request, for the run's own deadline. */
  signal?: AbortSignal;
}

export interface Model {
  /** The model's name, saved with each run, like "gemini-3.1-flash-lite". */
  name: string;
  /**
   * Sends the conversation, and resolves with the model's reply. Rejects with:
   * - a ModelError when the provider fails;
   * - any error once `signal` has fired, so check `signal.aborted` first;
   * - a plain Error for a bug in the caller, like a conversation that breaks
   *   checkConversation's rules.
   */
  next: (request: ModelRequest) => Promise<ModelReply>;
}

// A run: one question, answered by the agent loop in run.ts. Its events, and
// the tool steps inside them, are in @dashgen/contracts, since the page reads them.

/** One request to the model: the tools it called, or why it failed. */
export type ModelStep = { ms: number } & (
  ({ calls: string[]; finishReason: string } & Usage) | { error: string }
);

/** Every model and tool call, in order, as a run keeps them for the runs table. */
export type RunStep =
  ({ type: "model" } & ModelStep) | ({ type: "tool" } & ToolStep);

/** How a run ends: its last event, an outcome or an error. */
export type RunEnd = Exclude<RunEvent, { type: "step" }>;

/** A finished run, with what the runs table keeps. */
export interface RunResult {
  end: RunEnd;
  steps: RunStep[];
  /** The model's name, like "gemini-3.1-flash-lite". */
  model: string;
  /** Across every model call, for the run's cost. */
  usage: Usage;
  ms: number;
}

/**
 * The body of an error from the Gemini or Claude API, for its own reason in
 * our messages: both put it at `error.message`.
 */
export const ProviderErrorBody = z.object({
  error: z.object({ message: z.string() }),
});

/** A token count: a whole number, never below 0. */
const TokenCount = z.number().int().nonnegative();

/**
 * What the Claude adapter reads from an answer, checked before it's read: the
 * SDK hands back a body it can't read as JSON as it is. A call needs its ID,
 * or its tool would run and its result couldn't go back to Claude, and a count
 * that isn't a number would turn the run's tokens into text.
 */
export const ClaudeAnswer = z.object({
  content: z.array(
    z.union([
      z.object({
        type: z.literal("tool_use"),
        id: z.string().min(1),
        name: z.string().min(1),
        input: z.record(z.string(), z.unknown()),
      }),
      z.object({ type: z.literal("text"), text: z.string() }),
      // Any other block, like thinking, only goes back to Claude as it came.
      z.object({
        type: z
          .string()
          .refine((type) => type !== "tool_use" && type !== "text"),
      }),
    ]),
  ),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: TokenCount,
    output_tokens: TokenCount,
    cache_creation_input_tokens: TokenCount.nullish(),
    cache_read_input_tokens: TokenCount.nullish(),
  }),
});
