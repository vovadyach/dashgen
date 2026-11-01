// The shapes DashGen's APIs send and receive. A service validates with these
// schemas, and its clients get their types from the same place, so the two
// can't drift apart. The same goes for the few values that both the backend
// and the page show.

import { z } from "zod";

/** A question's longest length, after trimming, in characters. */
export const QUESTION_MAX_LENGTH = 300;

/** How many days a metrics query covers when it doesn't say, and at most. */
export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 30;

/**
 * The most a chart holds: a series per query result, from at most 10 queries
 * a run, and a point per hour of the longest span. A chart that comes from
 * outside, like in a share link, can't be larger than any the backend makes.
 */
export const MAX_SERIES = 10;
export const MAX_POINTS = MAX_DAYS * 24;

/** A bug in DashGen, as visitors see it: in a 500, or as a run's last event. */
export const INTERNAL_ERROR = {
  code: "internal_error",
  message: "Something went wrong.",
} as const;

/** The made-up services in DashGen's sample data. */
export const SAMPLE_SERVICES = [
  "auth-service",
  "payments-service",
  "checkout-api",
  "search-service",
  "notifications-worker",
] as const;
export type SampleService = (typeof SAMPLE_SERVICES)[number];

/**
 * Questions that show what DashGen answers, each with a different chart: one
 * line, several lines, bars and a pie. The page offers them to new visitors,
 * and every refusal lists them.
 */
export const EXAMPLE_QUESTIONS = [
  "Show errors for payments-service this week",
  "Compare errors across all services over the last 7 days",
  "Which service was slowest over the last 3 days?",
  "Show each service's share of errors this week as a pie chart",
] as const;

/** Why a request failed: the `code` of an error response. */
export const ApiErrorCode = z.enum([
  "bad_request",
  "invalid_question",
  "not_found",
  "rate_limited",
  "run_not_found",
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/**
 * Every error response: a code for programs, and a message that's safe to
 * show visitors. The backend sends an `ApiErrorCode`, but any string parses,
 * so a page that's older than a new code still shows its message.
 */
export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** The backend's `GET /api/health` answer. */
export const Health = z.object({
  status: z.literal("ok"),
});
export type Health = z.infer<typeof Health>;

/**
 * The body of the backend's `POST /api/ask`: a question of 1 to 300 characters,
 * after trimming, with no NUL character, which Postgres can't store.
 */
export const AskRequest = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(QUESTION_MAX_LENGTH)
    .refine((question) => !question.includes("\u0000"), {
      error: "The question can't contain a NUL character.",
    }),
});
export type AskRequest = z.infer<typeof AskRequest>;

/** The backend's answer to `POST /api/ask`: the run it started, whose events stream from `GET /api/runs/:id/events`. */
export const AskResponse = z.object({
  runId: z.uuid(),
});
export type AskResponse = z.infer<typeof AskResponse>;

/** What the metrics module offers: every service, and each metric's unit and rollup. */
export const ServiceCatalog = z.object({
  services: z.array(z.string()),
  metrics: z.array(
    z.object({
      name: z.string(),
      unit: z.string(),
      rollup: z.enum(["sum", "avg"]),
    }),
  ),
});
export type ServiceCatalog = z.infer<typeof ServiceCatalog>;

export const Bucket = z.enum(["hour", "day"]);
export type Bucket = z.infer<typeof Bucket>;

/** A metrics query. `bucket` defaults to hourly up to 2 days, daily beyond. */
export const MetricsQuery = z.object({
  service: z.string().min(1),
  metric: z.string().min(1),
  days: z.number().int().min(1).max(MAX_DAYS).default(DEFAULT_DAYS),
  bucket: Bucket.optional(),
});
export type MetricsQuery = z.input<typeof MetricsQuery>;

/** One series and its summary. The summary comes from the hourly rows, whatever the bucket. */
export const MetricsResult = z.object({
  service: z.string(),
  metric: z.string(),
  unit: z.string(),
  days: z.number(),
  bucket: Bucket,
  points: z.array(
    z.object({
      t: z.iso.datetime(),
      value: z.number(),
      partial: z.literal(true).optional(),
    }),
  ),
  summary: z.object({
    total: z.number().optional(),
    avg: z.number(),
    min: z.number(),
    max: z.number(),
    latest: z.number(),
  }),
});
export type MetricsResult = z.infer<typeof MetricsResult>;

export const ChartType = z.enum(["line", "bar", "pie"]);
export type ChartType = z.infer<typeof ChartType>;

/** An ISO time on a real date: Zod's check rejects Feb 31 too. */
const IsoTime = z.iso.datetime();

/**
 * A chart the backend built from real query results. It carries its own numbers,
 * so the page can draw it, or redraw a pinned one, without asking for anything else.
 */
export const Chart = z
  .object({
    type: ChartType,
    title: z.string().trim().min(1).max(120),
    unit: z.string(),
    /**
     * What the x values are: hours or days (ISO timestamps), or categories (service names).
     * Days are UTC midnights, so label them in UTC: in local time, every day west of UTC shows as the day before.
     */
    x: z.enum(["hour", "day", "category"]),
    series: z
      .array(
        z.object({
          name: z.string(),
          points: z
            .array(
              z.object({
                x: z.string(),
                y: z.number(),
                /** A day with fewer than 24 hours of data. The page draws it lighter. */
                partial: z.literal(true).optional(),
              }),
            )
            .min(1)
            .max(MAX_POINTS),
        }),
      )
      .min(1)
      .max(MAX_SERIES),
  })
  .refine(
    // Hours and days must be real times. The page formats them, and a chart
    // from outside, like in a share link, could carry anything.
    (chart) =>
      chart.x === "category" ||
      chart.series.every((series) =>
        series.points.every((point) => IsoTime.safeParse(point.x).success),
      ),
    {
      error: "Each hour or day must be an ISO time, like 2026-10-25T00:00:00Z.",
    },
  );
export type Chart = z.infer<typeof Chart>;

const ChartOutcome = z.object({ outcome: z.literal("chart"), chart: Chart });
const ClarifyOutcome = z.object({
  outcome: z.literal("clarify"),
  message: z.string(),
  /** Complete questions; picking one asks it. */
  choices: z.array(z.string()).min(2).max(4),
});
const DeclineOutcome = z.object({
  outcome: z.literal("decline"),
  message: z.string(),
  examples: z.array(z.string()),
});

/** How a run ends, when it doesn't fail: a chart, a question back to the visitor, or a refusal. */
export const Outcome = z.discriminatedUnion("outcome", [
  ChartOutcome,
  ClarifyOutcome,
  DeclineOutcome,
]);
export type Outcome = z.infer<typeof Outcome>;

const toolCall = { tool: z.string(), args: z.unknown(), ms: z.number() };
const StepResult = z.object({ ...toolCall, result: z.string() });
const StepError = z.object({ ...toolCall, error: z.string() });

/** One tool call, as the page's steps panel shows it: a short line for its result, or why it failed. */
export const ToolStep = z.union([StepResult, StepError]);
export type ToolStep = z.infer<typeof ToolStep>;

/** Why a run failed. `internal_error` is a bug in DashGen. */
export const RunErrorCode = z.enum([
  "agent_failed",
  "unavailable",
  "timeout",
  "internal_error",
]);
export type RunErrorCode = z.infer<typeof RunErrorCode>;

/**
 * What the backend's `GET /api/runs/:id/events` streams, as each SSE event's data:
 * a step per tool call, then an outcome or an error, which ends the run. An
 * error's message is safe to show visitors. Each shape is spelled out, so the
 * API docs get plain objects.
 */
export const RunEvent = z.union([
  z.object({ type: z.literal("step"), ...StepResult.shape }),
  z.object({ type: z.literal("step"), ...StepError.shape }),
  z.object({ type: z.literal("outcome"), ...ChartOutcome.shape }),
  z.object({ type: z.literal("outcome"), ...ClarifyOutcome.shape }),
  z.object({ type: z.literal("outcome"), ...DeclineOutcome.shape }),
  z.object({
    type: z.literal("error"),
    code: RunErrorCode,
    message: z.string(),
  }),
]);
export type RunEvent = z.infer<typeof RunEvent>;
