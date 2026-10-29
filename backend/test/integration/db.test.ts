import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { services } from "../../src/metrics/schema.ts";
import { createTestDb, type TestDb } from "../helpers/db.ts";

// Collects what the database logs, instead of printing it.
const logged: { level: string; obj: object; msg: string }[] = [];
const log = {
  debug: (obj: object, msg: string) =>
    logged.push({ level: "debug", obj, msg }),
  info: (obj: object, msg: string) => logged.push({ level: "info", obj, msg }),
  warn: (obj: object, msg: string) => logged.push({ level: "warn", obj, msg }),
  error: (obj: object, msg: string) =>
    logged.push({ level: "error", obj, msg }),
};

let testDb: TestDb;

before(async () => {
  testDb = await createTestDb(log);
});

after(() => testDb.drop());

test("every query is logged at debug level, without its values", async () => {
  logged.length = 0;

  await testDb.db
    .select()
    .from(services)
    .where(eq(services.name, "a-value-someone-typed"));

  const sqlLines = logged.filter((line) => line.msg === "sql");
  const [line] = sqlLines;
  assert.equal(sqlLines.length, 1);
  assert.ok(line);
  assert.equal(line.level, "debug");
  const text = JSON.stringify(line.obj);
  assert.match(text, /from \\"services\\"/);
  assert.doesNotMatch(text, /a-value-someone-typed/);
});

test("a failed query says which SQL failed and why", async () => {
  await assert.rejects(
    testDb.db.execute(sql`select * from missing_table`),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /select \* from missing_table/);
      assert.match(
        String(error.cause),
        /relation "missing_table" does not exist/,
      );
      return true;
    },
  );
});
