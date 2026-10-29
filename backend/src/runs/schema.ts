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
    // Made by the backend when the question is asked, so `ask` can return it
    // before the run is saved. A UUIDv7, which starts with the time, so new rows
    // go to the end of the index (ADR-0009). The default, Postgres 18's own
    // uuidv7(), covers rows inserted any other way.
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
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
