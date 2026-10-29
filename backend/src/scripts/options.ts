// Shared by the scripts: LOG_LEVEL from the environment, and a statement
// timeout long enough for migrations and the seed (requests keep 2 seconds).
import { loadLogLevel } from "../config.ts";
import type { DbOptions } from "../db.ts";
import { consoleLogger } from "../logger.ts";

export const scriptDbOptions: DbOptions = {
  log: consoleLogger(loadLogLevel()),
  statementTimeoutMs: 5 * 60_000,
};
