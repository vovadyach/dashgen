// `npm run db:migrate`: applies the migrations this database hasn't run yet.
import { loadDatabaseUrl } from "../config.ts";
import { migrateDb, withDatabase } from "../db.ts";
import { scriptDbOptions } from "./options.ts";

await withDatabase(loadDatabaseUrl().reveal(), migrateDb, scriptDbOptions);
console.log("Migrations applied.");
