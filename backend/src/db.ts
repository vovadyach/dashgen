import path from "node:path";

import { DrizzleQueryError } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { consoleLogger, type Logger } from "./logger.ts";

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
