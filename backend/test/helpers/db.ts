import { randomUUIDv7 } from "node:crypto";

import { Pool } from "pg";

import { createDb, type Db, migrateDb } from "../../src/db.ts";
import type { Logger } from "../../src/logger.ts";

// The throwaway Postgres from compose.test.yaml, which `make check` starts.
// TEST_DATABASE_URL points the tests at another Postgres instead.
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:test@127.0.0.1:5433/postgres";

export interface TestDb {
  db: Db;
  drop: () => Promise<void>;
}

/**
 * A database that refuses every connection, as when Postgres is down: nothing
 * listens on port 1. Close it with `db.$client.end()`.
 */
export function unreachableDb(log?: Logger): Db {
  return createDb(
    "postgres://dashgen:unused@127.0.0.1:1/dashgen",
    log ? { log } : {},
  );
}

/** Creates a fresh, migrated database for one test file. Call `drop()` after its tests. */
export async function createTestDb(log?: Logger): Promise<TestDb> {
  // A random name, so test files running in parallel never share a database.
  const name = `test_${randomUUIDv7().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  let db: Db | undefined;

  const drop = async () => {
    await db?.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  };

  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    db = createDb(url.toString(), log ? { log } : {});
    await migrateDb(db);
    return { db, drop };
  } catch (error) {
    // Without this, a failed setup would leak the database and keep the process alive.
    await drop();
    throw error;
  }
}
