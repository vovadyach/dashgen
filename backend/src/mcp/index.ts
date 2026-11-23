// DashGen's tools for MCP clients, like Claude Code (ADR-0022).
import { MAX_SERIES } from "@dashgen/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createTools, type Tool, ToolError } from "../agent/index.ts";
import { withoutQueryValues } from "../db.ts";
import type { Logger } from "../logger.ts";
import type { Metrics } from "../metrics/index.ts";

/**
 * The agent's tools that an MCP client gets, with the agent's own names,
 * descriptions and schemas. clarify and decline end a run of DashGen's own
 * agent, which an MCP client doesn't have: its model can ask its user, or
 * refuse, by itself.
 */
const SHARED_TOOLS: ReadonlySet<string> = new Set([
  "list_services",
  "query_metrics",
]);

/**
 * The results that create_chart can use: twice a chart's 10 series. A session
 * has no limit on queries, so older results go, and its memory stays small.
 */
const KEEP_RESULTS = 2 * MAX_SERIES;

export interface McpServerOptions {
  log: Logger;
}

/**
 * DashGen's tools on `metrics`, for a client to connect to through a
 * transport: stdio for `npm run mcp`. The client's model calls them, so
 * DashGen calls no model.
 */
export function createMcpServer(
  metrics: Metrics,
  { log }: McpServerOptions,
): McpServer {
  const server = new McpServer({ name: "dashgen", version: "0.1.0" });
  const tools = createTools(metrics, {
    maxQueries: Number.POSITIVE_INFINITY,
    keepResults: KEEP_RESULTS,
  });
  for (const tool of tools) {
    if (!SHARED_TOOLS.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.args },
      (args) => callTool(tool, args, log),
    );
  }
  return server;
}

/**
 * Runs `tool`, and sends its result as JSON. A ToolError, like an unknown
 * service's name, goes back as an error for the client's model to correct.
 * Any other failure is logged, and the client gets a message without its
 * details, which can hold a query's values.
 */
async function callTool(
  tool: Tool,
  args: unknown,
  log: Logger,
): Promise<CallToolResult> {
  try {
    const result = await tool.call(args);
    const data = result.done ? result.outcome : result.result;
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (error) {
    if (error instanceof ToolError) return failed(error.message);
    log.error(
      { err: withoutQueryValues(error), tool: tool.name },
      "mcp tool failed",
    );
    return failed(`DashGen couldn't run ${tool.name}. Try again in a moment.`);
  }
}

function failed(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
