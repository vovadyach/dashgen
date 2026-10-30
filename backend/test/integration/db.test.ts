import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq, sql } from "drizzle-orm";

import { withoutQueryValues } from "../../src/db.ts";
import { services } from "../../src/metrics/schema.ts";
import { createTestDb, type TestDb } from "../helpers/db.ts";
import { recordingLogger } from "../helpers/logger.ts";

const { log, lines } = recordingLogger();
let testDb: TestDb | undefined;

before(async () => {
  testDb = await createTestDb(log);
});

after(() => testDb?.drop());

const db = () => {
  assert.ok(testDb);
  return testDb.db;
};

describe("database", () => {
  it("logs every query at debug level, without its values", async () => {
    lines.length = 0;

    await db()
      .select()
      .from(services)
      .where(eq(services.name, "a-value-someone-typed"));

    const sqlLines = lines.filter((line) => line.msg === "sql");
    const [line] = sqlLines;
    assert.equal(sqlLines.length, 1);
    assert.ok(line);
    assert.equal(line.level, "debug");
    const text = JSON.stringify(line.obj);
    assert.match(text, /from \\"services\\"/);
    assert.doesNotMatch(text, /a-value-someone-typed/);
  });

  it("keeps a failed query's SQL and reason for the logs, but not its values", async () => {
    const typed = "a-value-someone-typed";
    await assert.rejects(
      db().execute(sql`select * from missing_table where name = ${typed}`),
      (error) => {
        // Drizzle's own message includes the values...
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(typed));

        // ...so they're removed before logging.
        const logged = withoutQueryValues(error);
        assert.ok(logged instanceof Error);
        assert.match(logged.message, /select \* from missing_table/);
        assert.doesNotMatch(logged.message, new RegExp(typed));
        assert.doesNotMatch(logged.stack ?? "", new RegExp(typed));
        assert.match(
          String(logged.cause),
          /relation "missing_table" does not exist/,
        );
        return true;
      },
    );
  });

  it("gives up on a statement Postgres doesn't answer, a second after Postgres's own timeout", async () => {
    const client = await db().$client.connect();
    // As if Postgres stopped answering: its own timeout won't end this sleep.
    await client.query("set statement_timeout = 0");
    const started = performance.now();
    try {
      await assert.rejects(client.query("select pg_sleep(5)"), {
        message: "Query read timeout",
      });
    } finally {
      // Not back to the pool: the sleep still runs on this connection.
      client.release(true);
    }
    // The 2-second statement timeout, plus a second.
    assert.ok(performance.now() - started < 4_000);
  });
});
