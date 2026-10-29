// `npm run db:seed`: replaces the sample data with 30 days ending this hour.
import { loadDatabaseUrl } from "../config.ts";
import { withDatabase } from "../db.ts";
import { seedMetrics } from "../metrics/seed.ts";
import { scriptDbOptions } from "./options.ts";

const count = await withDatabase(
  loadDatabaseUrl().reveal(),
  (db) => seedMetrics(db, new Date()),
  scriptDbOptions,
);
console.log(`Seeded ${String(count)} points.`);
