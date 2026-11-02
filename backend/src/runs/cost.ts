import { count, desc, sql } from "drizzle-orm";

import { type Db, type RetryOptions, retryOnce } from "../db.ts";
import { runs } from "./schema.ts";

/** A UTC day's runs: the questions that reached the agent, and what they cost. */
export interface DayCost {
  /** Like 2026-11-02. */
  day: string;
  questions: number;
  costUsd: number;
}

/** Each UTC day's runs and their cost, newest first. A read, so it gets the database retry. */
export async function costByDay(
  db: Db,
  options?: RetryOptions,
): Promise<DayCost[]> {
  const day = sql<string>`to_char(${runs.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  return retryOnce(
    async () =>
      db
        .select({
          day,
          questions: count(),
          costUsd: sql<number>`sum(${runs.costUsd})`.mapWith(Number),
        })
        .from(runs)
        .groupBy(day)
        .orderBy(desc(day)),
    options,
  );
}

// To the hundredth of a cent: a question costs about one cent.
const usd = (amount: number) => `$${amount.toFixed(4)}`;

/** The days as a table for the terminal, with a total under them. */
export function formatCosts(days: DayCost[]): string {
  if (days.length === 0) return "No runs yet.";
  const questions = days.reduce((sum, d) => sum + d.questions, 0);
  const cost = days.reduce((sum, d) => sum + d.costUsd, 0);
  const row = (label: string, n: number, usdTotal: number) => [
    label,
    String(n),
    usd(usdTotal),
    usd(usdTotal / n),
  ];
  const rows = [
    ["Day (UTC)", "Questions", "Cost", "Per question"],
    ...days.map((d) => row(d.day, d.questions, d.costUsd)),
    row("Total", questions, cost),
  ];
  const widths = [0, 1, 2, 3].map((column) =>
    Math.max(...rows.map((cells) => (cells[column] ?? "").length)),
  );
  // The day on the left, and the numbers lined up on the right.
  return rows
    .map((cells) =>
      cells
        .map((cell, column) =>
          column === 0
            ? cell.padEnd(widths[column] ?? 0)
            : cell.padStart(widths[column] ?? 0),
        )
        .join("   "),
    )
    .join("\n");
}
