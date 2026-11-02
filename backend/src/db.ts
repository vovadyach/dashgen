import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { DrizzleQueryError } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { consoleLogger, type Logger } from "./logger.ts";
import { retryDelay } from "./shared/retry.ts";

/** Drizzle over a pg pool. `db.$client.end()` closes the pool. */
export type Db = NodePgDatabase & { $client: Pool };

export interface DbOptions {
  log?: Logger;
  /** Postgres cancels a statement that runs longer. Short for requests; scripts pass a long one. */
  statementTimeoutMs?: number;
}

/** Opens a connection pool wrapped in Drizzle. Close it with `db.$client.end()`. */
export function createDb(
  url: string,
  { log = consoleLogger(), statementTimeoutMs = 2_000 }: DbOptions = {},
): Db {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 2_000, // fail fast when no connection is free
    idleTimeoutMillis: 30_000,
    statement_timeout: statementTimeoutMs,
    // If Postgres stops answering, its own timeout never fires, so give up a
    // second later. The pool then closes that connection instead of reusing it.
    query_timeout: statementTimeoutMs + 1_000,
  });
  // A dropped idle connection emits "error", which would crash Node unhandled.
  pool.on("error", (err) => {
    log.error({ err }, "an idle database connection failed");
  });
  return drizzle({
    client: pool,
    // Every statement at debug level. Only the SQL text: values may hold user input.
    logger: {
      logQuery: (query) => {
        log.debug({ query }, "sql");
      },
    },
  });
}

/** Opens a pool, runs `work`, and always closes the pool, so a script can exit. */
export async function withDatabase<T>(
  url: string,
  work: (db: Db) => Promise<T>,
  options?: DbOptions,
): Promise<T> {
  const db = createDb(url, options);
  try {
    return await work(db);
  } finally {
    await db.$client.end();
  }
}

/** Applies the SQL migrations in ../drizzle that this database hasn't run yet. */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, {
    migrationsFolder: path.join(import.meta.dirname, "..", "drizzle"),
  });
}

// Codes of failures that can pass. Postgres's (SQLSTATE): a statement over its
// time, a server out of connections, and one that's stopping or starting.
// Node's: a network that failed.
const RETRYABLE_CODES = new Set([
  "57014",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);
// Postgres's class of codes for a lost connection.
const CONNECTION_CLASS = "08";
// pg's own timeouts and lost connections, which come with no code.
const RETRYABLE_MESSAGES = new Set([
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
  "Connection terminated unexpectedly",
  "Query read timeout",
]);

/**
 * Whether trying again could fix a failed database call: the connection
 * failed, the server was busy, stopping or starting, or the call ran out of
 * time. Anything else, like a wrong password or a missing table, fails the
 * same way again.
 */
export function isRetryable(error: unknown): boolean {
  // Drizzle wraps what the driver throws.
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (!(cause instanceof Error)) return false;
  const code = "code" in cause ? cause.code : undefined;
  if (typeof code !== "string") return RETRYABLE_MESSAGES.has(cause.message);
  return RETRYABLE_CODES.has(code) || code.startsWith(CONNECTION_CLASS);
}

export interface RetryOptions {
  log?: Logger;
  /** The wait before the second try, so tests can skip it. */
  retryDelayMs?: () => number;
  /** Aborts when the caller stops waiting, like a run at its deadline. */
  signal?: AbortSignal;
}

/**
 * Runs `call`, and once more after a short random wait if it failed in a way
 * that trying again could fix (docs/design.md, when things go wrong). Only for
 * a call that's safe to repeat, like a read. Once `signal` aborts, the wait
 * ends, and there's no second try.
 */
export async function retryOnce<T>(
  call: () => Promise<T>,
  {
    log = consoleLogger(),
    retryDelayMs = retryDelay,
    signal,
  }: RetryOptions = {},
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!isRetryable(error) || signal?.aborted) throw error;
    log.warn(
      { err: withoutQueryValues(error) },
      "database call failed, retrying",
    );
  }
  await sleep(retryDelayMs(), undefined, { signal });
  signal?.throwIfAborted();
  return call();
}

/**
 * A failed query's error message lists its values (`params: …`), which can hold
 * user input. Before logging, this keeps the SQL and Postgres's reason, and drops the values.
 */
export function withoutQueryValues(error: unknown): unknown {
  if (!(error instanceof DrizzleQueryError)) return error;
  const redacted = new Error(`Failed query: ${error.query}`, {
    cause: error.cause,
  });
  redacted.name = "DrizzleQueryError";
  if (error.stack !== undefined)
    redacted.stack = error.stack.replace(error.message, redacted.message);
  return redacted;
}
