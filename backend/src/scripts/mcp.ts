// DashGen's tools for an MCP client, like Claude Code, over stdio
// (ADR-0022). The client starts it with node, never through npm, whose banner
// would go to stdout. From the repo root:
//   claude mcp add dashgen -- node --env-file-if-exists="$PWD/backend/.env" "$PWD/backend/src/scripts/mcp.ts"
// The two talk through its stdin and stdout, so every log line goes to
// stderr. It needs only DATABASE_URL, and PAGE_URL for its chart links.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadDatabaseUrl, loadLogLevel, loadPageUrl } from "../config.ts";
import { createDb } from "../db.ts";
import { consoleLogger } from "../logger.ts";
import { createMcpServer } from "../mcp/index.ts";
import { createMetrics } from "../metrics/index.ts";

const log = consoleLogger(loadLogLevel(), { stderr: true });
const db = createDb(loadDatabaseUrl().reveal(), { log });
const server = createMcpServer(createMetrics(db, { log }), {
  log,
  pageUrl: loadPageUrl(),
});

// The SDK's transport doesn't close when the client closes stdin, and the
// database's pool would keep the process up.
process.stdin.once("end", () => {
  server
    .close()
    .then(() => db.$client.end())
    .catch((err: unknown) => {
      log.error({ err }, "mcp server didn't close cleanly");
    });
});
await server.connect(new StdioServerTransport());
