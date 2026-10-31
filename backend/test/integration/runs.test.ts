import assert from "node:assert/strict";
import { randomUUIDv7 } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { saveRun } from "../../src/runs/index.ts";
import { runs } from "../../src/runs/schema.ts";
import { QUESTION } from "../fixtures/agent.ts";
import { createTestDb, type TestDb } from "../helpers/db.ts";
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
});
