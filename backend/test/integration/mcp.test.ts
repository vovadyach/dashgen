import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createTestDb, type TestDb } from "../helpers/db.ts";

const SCRIPT = fileURLToPath(
  new URL("../../src/scripts/mcp.ts", import.meta.url),
);

describe("npm run mcp", () => {
  let testDb: TestDb;

  before(async () => {
    testDb = await createTestDb();
  });

  after(async () => {
    await testDb.drop();
  });

  it("serves DashGen's tools over stdio, as Claude Code starts it, with every log line on stderr, even at debug level", async () => {
    // As a client starts it, with only the settings it's given: never backend/.env.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SCRIPT],
      env: { DATABASE_URL: testDb.url, LOG_LEVEL: "debug" },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const result = await client.callTool({
        name: "list_services",
        arguments: {},
      });

      assert.deepEqual(
        tools.map(({ name }) => name),
        ["list_services", "query_metrics"],
      );
      assert.notEqual(result.isError, true);
      // Each SQL statement is logged at debug level. On stdout, it would have
      // broken MCP's messages, and the calls above would have failed.
      assert.match(stderr, /^sql /m);
    } finally {
      await client.close();
    }
  });
});
