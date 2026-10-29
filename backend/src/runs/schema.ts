import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** One row per question that reached the agent, whatever the outcome. */
export const runs = pgTable(
  "runs",
  {
    // Also the request ID in the logs.
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    question: text("question").notNull(),
    outcome: text("outcome", {
      enum: ["chart", "clarify", "decline", "error"],
    }).notNull(),
    errorCode: text("error_code"),
    chart: jsonb("chart"),
    // Every model and tool call. Always read with its run, so no table of its own.
    steps: jsonb("steps").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
  },
  (t) => [
    // Step 4 adds up cost per day.
    index("runs_created_at_idx").on(t.createdAt),
    check(
      "runs_outcome_check",
      sql`${t.outcome} in ('chart', 'clarify', 'decline', 'error')`,
    ),
  ],
);
