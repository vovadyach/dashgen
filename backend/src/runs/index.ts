import type { Db } from "../db.ts";
import { runs } from "./schema.ts";

export { createRunStore, type RunStore } from "./live.ts";

/** A finished run, as the runs table keeps it. */
export type NewRun = typeof runs.$inferInsert;

/** Saves a finished run: one row per question that reached the agent, whatever the outcome. */
export async function saveRun(db: Db, run: NewRun): Promise<void> {
  await db.insert(runs).values(run);
}
