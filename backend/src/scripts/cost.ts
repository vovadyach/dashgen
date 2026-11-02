// `npm run cost`: each UTC day's questions and what they cost, from the runs
// table (docs/runbooks/costs.md).
import { loadDatabaseUrl } from "../config.ts";
import { withDatabase } from "../db.ts";
import { costByDay, formatCosts } from "../runs/index.ts";
import { scriptDbOptions } from "./options.ts";

const days = await withDatabase(
  loadDatabaseUrl().reveal(),
  (db) => costByDay(db, { log: scriptDbOptions.log }),
  scriptDbOptions,
);
console.log(formatCosts(days));
