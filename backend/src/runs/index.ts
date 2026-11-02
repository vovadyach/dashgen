import { type Db, type RetryOptions, retryOnce } from "../db.ts";
import { runs } from "./schema.ts";

export { createRunStore, type RunStore } from "./live.ts";

/**
 * A finished run, as the runs table keeps it: under the run's own ID, so
 * saving it again finds its row instead of adding a second one.
 */
export type NewRun = typeof runs.$inferInsert & { id: string };

/**
 * Saves a finished run: one row per question that reached the agent, whatever
 * the outcome. A failure that trying again could fix gets one more try. When
 * the first try saved the row but its reply was lost, the second finds the
 * row there and does nothing.
 */
export async function saveRun(
  db: Db,
  run: NewRun,
  options?: RetryOptions,
): Promise<void> {
  await retryOnce(async () => {
    await db.insert(runs).values(run).onConflictDoNothing({ target: runs.id });
  }, options);
}
