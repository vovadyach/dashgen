import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DrizzleQueryError } from "drizzle-orm";

import { isRetryable, retryOnce } from "../../src/db.ts";
import { MetricsError } from "../../src/metrics/index.ts";
import { recordingLogger } from "../helpers/logger.ts";

/** A failed query, as Drizzle reports what the driver threw. */
const failedQuery = (cause: Error) =>
  new DrizzleQueryError('select * from "services"', [], cause);

/** An error with Postgres's code for it (SQLSTATE), or Node's. */
const withCode = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

/** A call that fails with each of `errors` in turn, then gets its rows. */
function flaky(...errors: Error[]) {
  const tries = { count: 0 };
  const call = () => {
    tries.count += 1;
    const error = errors.shift();
    return error ? Promise.reject(error) : Promise.resolve("rows");
  };
  return { call, tries };
}

describe("retryOnce", () => {
  it("tries once more, after a wait, when the failure can pass, like a dropped connection", async () => {
    const { log, lines } = recordingLogger();
    const { call, tries } = flaky(
      failedQuery(withCode("ECONNRESET", "read ECONNRESET")),
    );
    let waits = 0;

    const rows = await retryOnce(call, {
      log,
      retryDelayMs: () => {
        waits += 1;
        return 0;
      },
    });

    assert.equal(rows, "rows");
    assert.equal(tries.count, 2);
    assert.equal(waits, 1);
    assert.deepEqual(
      lines.map((line) => `${line.level}: ${line.msg}`),
      ["warn: database call failed, retrying"],
    );
  });

  it("gives up when the second try fails too", async () => {
    const starting = () =>
      failedQuery(withCode("57P03", "the database system is starting up"));
    const second = starting();
    const { call, tries } = flaky(starting(), second);

    await assert.rejects(
      retryOnce(call, { log: recordingLogger().log, retryDelayMs: () => 0 }),
      (error) => error === second,
    );
    assert.equal(tries.count, 2);
  });

  it("fails at once when trying again would fail the same way, like a missing table", async () => {
    const { log, lines } = recordingLogger();
    const missing = failedQuery(
      withCode("42P01", 'relation "missing_table" does not exist'),
    );
    const { call, tries } = flaky(missing);

    await assert.rejects(
      retryOnce(call, { log, retryDelayMs: () => 0 }),
      (error) => error === missing,
    );
    assert.equal(tries.count, 1);
    assert.deepEqual(lines, []);
  });

  it("ends the wait, with no second try, once the caller stops waiting, as at a run's deadline", async () => {
    const stop = new AbortController();
    const { call, tries } = flaky(
      failedQuery(withCode("ECONNRESET", "read ECONNRESET")),
    );
    const started = performance.now();

    await assert.rejects(
      retryOnce(call, {
        log: recordingLogger().log,
        retryDelayMs: () => {
          setTimeout(() => {
            stop.abort();
          }, 5);
          return 2_000;
        },
        signal: stop.signal,
      }),
      { name: "AbortError" },
    );
    assert.equal(tries.count, 1);
    // The wait ends when the caller stops waiting, not after its 2 seconds.
    assert.ok(performance.now() - started < 1_000);
  });

  it("doesn't wait at all when the caller stopped waiting during the first try", async () => {
    const { log, lines } = recordingLogger();
    const lost = failedQuery(withCode("ECONNRESET", "read ECONNRESET"));
    const { call, tries } = flaky(lost);
    let waits = 0;

    await assert.rejects(
      retryOnce(call, {
        log,
        retryDelayMs: () => {
          waits += 1;
          return 0;
        },
        signal: AbortSignal.abort(),
      }),
      (error) => error === lost,
    );
    assert.equal(tries.count, 1);
    assert.equal(waits, 0);
    assert.deepEqual(lines, []);
  });
});

describe("isRetryable", () => {
  it("marks pg's own timeouts and lost connections, which have no code, as worth one more try", () => {
    for (const message of [
      "timeout exceeded when trying to connect",
      "Connection terminated due to connection timeout",
      "Connection terminated unexpectedly",
      "Query read timeout",
    ]) {
      assert.equal(isRetryable(failedQuery(new Error(message))), true, message);
    }
  });

  it("marks a server out of connections, or out of reach for a moment, as worth one more try", () => {
    for (const error of [
      withCode("53300", "sorry, too many clients already"),
      withCode("08006", "connection failure"),
      withCode("EAI_AGAIN", "getaddrinfo EAI_AGAIN db.internal"),
    ]) {
      assert.equal(isRetryable(failedQuery(error)), true, error.message);
    }
  });

  it("doesn't retry what fails the same way again, nor what isn't the database's failure", () => {
    for (const error of [
      failedQuery(
        withCode("28P01", 'password authentication failed for user "dashgen"'),
      ),
      failedQuery(withCode("ENOTFOUND", "getaddrinfo ENOTFOUND db.internal")),
      // The app closing its own pool.
      failedQuery(new Error("Cannot use a pool after calling end on the pool")),
      new MetricsError('Unknown service "billing".'),
      new TypeError("Cannot read properties of undefined"),
    ]) {
      assert.equal(isRetryable(error), false, error.message);
    }
  });
});
