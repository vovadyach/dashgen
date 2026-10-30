import {
  AskRequest,
  Chart,
  ChartType,
  MetricsQuery,
  type Outcome,
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
// a scripted fake and never call Gemini.

/** A tool call the model asked for. Gemini may give it an `id`, sent back with its result. */
export interface ToolCall {
  id?: string;
  name: string;
  args: unknown;
}

/** What one tool call returned, for the model: its result, or the ToolError's message. */
export type ToolOutput =
  | { call: ToolCall; result: Record<string, unknown> }
  | { call: ToolCall; error: string };

/** The tokens of one request, or of a whole run. Gemini bills thinking as output. */
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
  /** Why the model stopped, as the provider says it, like "STOP" or "MAX_TOKENS". */
  finishReason: string;
  usage: Usage;
  /**
   * The reply exactly as the provider sent it, whenever it has calls. Put the
   * whole ModelReply back in the conversation: Gemini 3 checks the signatures
   * inside it on the next request.
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

// A run: one question, answered by the agent loop in run.ts.

/** One tool call, as the page's steps panel shows it: a short line for its result, or why it failed. */
export type ToolStep = { tool: string; args: unknown; ms: number } & (
  { result: string } | { error: string }
);

/** One request to the model: the tools it called, or why it failed. */
export type ModelStep = { ms: number } & (
  ({ calls: string[]; finishReason: string } & Usage) | { error: string }
);

/** Every model and tool call, in order, as a run keeps them for the runs table. */
export type RunStep =
  ({ type: "model" } & ModelStep) | ({ type: "tool" } & ToolStep);

export type RunErrorCode = "agent_failed" | "unavailable" | "timeout";

/** How a run ends: its outcome, or an error whose message is safe to show visitors. */
export type RunEnd =
  | ({ type: "outcome" } & Outcome)
  | { type: "error"; code: RunErrorCode; message: string };

/** What the page gets as a run goes: a step per tool call, then how it ended. */
export type RunEvent = ({ type: "step" } & ToolStep) | RunEnd;

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

/** The body of an error from the Gemini API, for its own reason in our messages. */
export const GeminiErrorBody = z.object({
  error: z.object({ message: z.string() }),
});
