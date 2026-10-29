import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { runs } from "../../src/runs/schema.ts";
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

test("a run saved without an ID gets a UUIDv7 from Postgres", async () => {
  const [row] = await db()
    .insert(runs)
    .values({
      question: "Show errors for payments-service this week",
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
