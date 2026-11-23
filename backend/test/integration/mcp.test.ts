import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createTestDb, type TestDb } from "../helpers/db.ts";

const SCRIPT = fileURLToPath(
  new URL("../../src/scripts/mcp.ts", import.meta.url),
);

describe("the MCP server over stdio", () => {
  let testDb: TestDb;
  let dir: string;
  let envFile: string;

  before(async () => {
    testDb = await createTestDb();
    // A settings file of its own, in place of backend/.env, which tests never read.
    dir = mkdtempSync(join(tmpdir(), "dashgen-mcp-"));
    envFile = join(dir, ".env");
    writeFileSync(envFile, `DATABASE_URL=${testDb.url}\nLOG_LEVEL=debug\n`);
  });

  after(async () => {
    await testDb.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves DashGen's tools when started as the docs say, with every log line on stderr, even at debug level", async () => {
    // The documented command: node with a settings file, never npm, whose banner would go to stdout.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [`--env-file-if-exists=${envFile}`, SCRIPT],
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
        ["list_services", "query_metrics", "create_chart"],
      );
      assert.notEqual(result.isError, true);
      // Each SQL statement is logged at debug level, from the settings file.
      // On stdout, it would have broken MCP's messages, and the calls above
      // would have failed.
      assert.match(stderr, /^sql /m);
    } finally {
      await client.close();
    }
  });
});
