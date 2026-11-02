import assert from "node:assert/strict";
import { randomUUIDv7 } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { isRetryable } from "../../src/db.ts";
import { type NewRun, saveRun } from "../../src/runs/index.ts";
import { runs } from "../../src/runs/schema.ts";
import { QUESTION } from "../fixtures/agent.ts";
import { createTestDb, type TestDb, unreachableDb } from "../helpers/db.ts";
import { recordingLogger } from "../helpers/logger.ts";
import { assertRecentUuidV7 } from "../helpers/uuid.ts";

let testDb: TestDb | undefined;

before(async () => {
  testDb = await createTestDb();
});

after(() => testDb?.drop());

const db = () => {
  assert.ok(testDb);
  return testDb.db;
};

/** A finished run, under an ID of its own, as the run's route saves it. */
const finishedRun = (): NewRun => ({
  id: randomUUIDv7(),
  question: QUESTION,
  outcome: "chart",
  steps: [],
  model: "gemini-3.1-flash-lite",
  inputTokens: 8_000,
  outputTokens: 300,
  costUsd: "0.0025",
  latencyMs: 4_200,
});

describe("runs table", () => {
  it("gives a run saved without an ID a UUIDv7 from Postgres", async () => {
    const [row] = await db()
      .insert(runs)
      .values({
        question: QUESTION,
        outcome: "chart",
        steps: [],
        model: "gemini-3.1-flash-lite",
        inputTokens: 8_000,
        outputTokens: 300,
        costUsd: "0.0025",
        latencyMs: 4_200,
      })
      .returning({ id: runs.id });

    assert.ok(row);
    assertRecentUuidV7(row.id);
  });

  it("keeps a run saveRun saves, cost and all", async () => {
    const id = randomUUIDv7();

    await saveRun(db(), {
      id,
      question: QUESTION,
      outcome: "error",
      errorCode: "timeout",
      steps: [{ type: "model", ms: 25_000, error: "timed out" }],
      model: "gemini-3.1-flash-lite",
      inputTokens: 8_000,
      outputTokens: 300,
      costUsd: "0.002450",
      latencyMs: 25_000,
    });

    const [row] = await db().select().from(runs).where(eq(runs.id, id));
    assert.ok(row);
    assert.equal(row.errorCode, "timeout");
    assert.equal(row.costUsd, "0.002450");
    assert.deepEqual(row.steps, [
      { type: "model", ms: 25_000, error: "timed out" },
    ]);
  });

  it("tries a save once more when the database can't be reached, then gives up", async () => {
    const { log, lines } = recordingLogger();
    const down = unreachableDb(log);
    try {
      await assert.rejects(
        saveRun(down, finishedRun(), { log, retryDelayMs: () => 0 }),
        (error) => isRetryable(error),
      );
    } finally {
      await down.$client.end();
    }
    assert.deepEqual(
      lines.filter((line) => line.level === "warn").map((line) => line.msg),
      ["database call failed, retrying"],
    );
  });

  it("keeps one row when a run is saved again, as by a retry after a lost reply", async () => {
    const run = finishedRun();

    await saveRun(db(), run);
    await saveRun(db(), run);

    assert.equal(await db().$count(runs, eq(runs.id, run.id)), 1);
  });

  it("takes only a run with its own ID, since a retry of one without could add a second row", () => {
    // @ts-expect-error The run's ID is required.
    const run: NewRun = { ...finishedRun(), id: undefined };
    assert.equal(run.id, undefined);
  });
});
