import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import { createDb, type Db, migrateDb } from "../../src/db.ts";
import type { Logger } from "../../src/logger.ts";

// The throwaway Postgres from compose.test.yaml, which `make check` starts.
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:test@127.0.0.1:5433/postgres";

export interface TestDb {
  db: Db;
  drop: () => Promise<void>;
}

/** Creates a fresh, migrated database for one test file. Call `drop()` after its tests. */
export async function createTestDb(log?: Logger): Promise<TestDb> {
  // A random name, so test files running in parallel never share a database.
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const { db, pool } = createDb(url.toString(), log);
  await migrateDb(db);

  return {
    db,
    drop: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
