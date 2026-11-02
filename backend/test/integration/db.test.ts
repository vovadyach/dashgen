import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq, sql } from "drizzle-orm";

import { isRetryable, withoutQueryValues } from "../../src/db.ts";
import { services } from "../../src/metrics/schema.ts";
import { createTestDb, type TestDb, unreachableDb } from "../helpers/db.ts";
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
      await assert.rejects(client.query("select pg_sleep(5)"), (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Query read timeout");
        // A server that stops answering can come back.
        assert.equal(isRetryable(error), true);
        return true;
      });
    } finally {
      // Not back to the pool: the sleep still runs on this connection.
      client.release(true);
    }
    // The 2-second statement timeout, plus a second.
    assert.ok(performance.now() - started < 4_000);
  });

  it("marks real failures that can pass as worth one more try, but not one that can't", async () => {
    const failure = async (call: Promise<unknown>) => {
      try {
        await call;
      } catch (error) {
        return error;
      }
      return assert.fail("The call should have failed.");
    };

    // A statement over its time.
    const slow = await failure(
      db().transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = 20`);
        await tx.execute(sql`select pg_sleep(1)`);
      }),
    );
    // The server ending the connection, as when it stops.
    const ended = await failure(
      db().execute(sql`select pg_terminate_backend(pg_backend_pid())`),
    );
    // A server that isn't there.
    const down = unreachableDb(log);
    const refused = await failure(down.execute(sql`select 1`));
    await down.$client.end();
    // A query that fails the same way each time.
    const missing = await failure(
      db().execute(sql`select * from missing_table`),
    );

    assert.deepEqual(
      [slow, ended, refused, missing].map((error) => isRetryable(error)),
      [true, true, true, false],
    );
  });
});
