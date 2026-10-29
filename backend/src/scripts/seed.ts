// `npm run db:seed`: replaces the sample data with 30 days ending this hour.
import { loadDatabaseUrl } from "../config.ts";
import { withDatabase } from "../db.ts";
import { seedMetrics } from "../metrics/seed.ts";

const count = await withDatabase(loadDatabaseUrl().reveal(), (db) =>
  seedMetrics(db, new Date()),
);
console.log(`Seeded ${String(count)} points.`);
