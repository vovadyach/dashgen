import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const services = pgTable("services", {
  name: text("name").primaryKey(),
});

export const metrics = pgTable(
  "metrics",
  {
    name: text("name").primaryKey(),
    unit: text("unit").notNull(),
    // How hourly values combine into longer buckets: errors add up, latency averages.
    rollup: text("rollup", { enum: ["sum", "avg"] }).notNull(),
  },
  (t) => [check("metrics_rollup_check", sql`${t.rollup} in ('sum', 'avg')`)],
);

/** One row per metric, service and hour. */
export const points = pgTable(
  "points",
  {
    metric: text("metric")
      .notNull()
      .references(() => metrics.name),
    service: text("service")
      .notNull()
      .references(() => services.name),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    value: doublePrecision("value").notNull(),
  },
  // Exact matches first, the time range last: one index slice per query.
  (t) => [primaryKey({ columns: [t.metric, t.service, t.recordedAt] })],
);
