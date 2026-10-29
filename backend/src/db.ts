import path from "node:path";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { consoleLogger, type Logger } from "./logger.ts";

export type Db = NodePgDatabase;

export interface Database {
  db: Db;
  pool: Pool;
}

/**
 * Opens a connection pool wrapped in Drizzle. Call `pool.end()` when done.
 * A failed query throws an error that carries its SQL and Postgres's reason.
 */
export function createDb(url: string, log: Logger = consoleLogger): Database {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 2_000, // fail fast when no connection is free
    idleTimeoutMillis: 30_000,
    statement_timeout: 2_000, // Postgres cancels a query that runs longer
  });
  // A dropped idle connection emits "error", which would crash Node unhandled.
  pool.on("error", (err) => {
    log.error({ err }, "an idle database connection failed");
  });
  const db = drizzle({
    client: pool,
    // Every statement at debug level. Only the SQL text: values may hold user input.
    logger: {
      logQuery: (query) => {
        log.debug({ query }, "sql");
      },
    },
  });
  return { db, pool };
}

/** Opens a pool, runs `work`, and always closes the pool, so a script can exit. */
export async function withDatabase<T>(
  url: string,
  work: (db: Db) => Promise<T>,
): Promise<T> {
  const { db, pool } = createDb(url);
  try {
    return await work(db);
  } finally {
    await pool.end();
  }
}

/** Applies the SQL migrations in ../drizzle that this database hasn't run yet. */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, {
    migrationsFolder: path.join(import.meta.dirname, "..", "drizzle"),
  });
}
