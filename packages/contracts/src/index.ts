// The shapes DashGen's APIs send and receive. A service validates with these
// schemas, and its clients get their types from the same place, so the two
// can't drift apart.

import { z } from "zod";

/** Every error response: a code for programs, and a message that's safe to show visitors. */
export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** The backend's `GET /health` answer. */
export const Health = z.object({
  status: z.literal("ok"),
});
export type Health = z.infer<typeof Health>;

/** The body of the backend's `POST /ask`: a question of 1 to 300 characters, after trimming. */
export const AskRequest = z.object({
  question: z.string().trim().min(1).max(300),
});
export type AskRequest = z.infer<typeof AskRequest>;

/** The backend's answer to `POST /ask`: the run it started, whose events stream from `GET /runs/:id/events`. */
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
  days: z.number().int().min(1).max(30).default(7),
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

/**
 * A chart the backend built from real query results. It carries its own numbers,
 * so the page can draw it, or redraw a pinned one, without asking for anything else.
 */
export const Chart = z.object({
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
          .min(1),
      }),
    )
    .min(1),
});
export type Chart = z.infer<typeof Chart>;

/** How a run ends, when it doesn't fail: a chart, a question back to the visitor, or a refusal. */
export const Outcome = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("chart"), chart: Chart }),
  z.object({
    outcome: z.literal("clarify"),
    message: z.string(),
    /** Complete questions; picking one asks it. */
    choices: z.array(z.string()).min(2).max(4),
  }),
  z.object({
    outcome: z.literal("decline"),
    message: z.string(),
    examples: z.array(z.string()),
  }),
]);
export type Outcome = z.infer<typeof Outcome>;
