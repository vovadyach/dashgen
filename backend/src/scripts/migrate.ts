// `npm run db:migrate`: applies the migrations this database hasn't run yet.
import { loadDatabaseUrl } from "../config.ts";
import { migrateDb, withDatabase } from "../db.ts";

await withDatabase(loadDatabaseUrl().reveal(), migrateDb);
console.log("Migrations applied.");
