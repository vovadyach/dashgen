// DashGen's tools for MCP clients, like Claude Code (ADR-0022).
import { MAX_SERIES } from "@dashgen/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CallToolResult,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

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
 * transport: stdio, for `backend/src/scripts/mcp.ts`. The client's model calls
 * them, so DashGen calls no model.
 *
 * It answers tools/list and tools/call itself, on the SDK's low-level server,
 * rather than through registerTool, whose own check would turn a wrong call
 * down before the tool sees it. Then every call reaches the agent's tool,
 * which checks it and counts it, wrong ones too, so result IDs follow the
 * calls, as they do for the agent.
 */
export function createMcpServer(
  metrics: Metrics,
  { log }: McpServerOptions,
): McpServer {
  const tools = createTools(metrics, {
    maxQueries: Number.POSITIVE_INFINITY,
    keepResults: KEEP_RESULTS,
  }).filter(({ name }) => SHARED_TOOLS.has(name));
  const mcp = new McpServer(
    { name: "dashgen", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      // As the Claude adapter sends it to DashGen's own model.
      inputSchema: {
        ...z.toJSONSchema(tool.args, { io: "input" }),
        type: "object" as const,
      },
    })),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, (request, { signal }) => {
    const tool = tools.find(({ name }) => name === request.params.name);
    if (!tool) {
      return failed(
        `DashGen has no tool named ${request.params.name}. Its tools: ${tools.map(({ name }) => name).join(", ")}.`,
      );
    }
    return callTool(tool, request.params.arguments, signal, log);
  });
  return mcp;
}

/**
 * Runs `tool`, and sends its result as JSON. A ToolError, like an unknown
 * service's name, goes back as an error for the client's model to correct.
 * Any other failure is logged, and the client gets a message without its
 * details, which can hold a query's values. `signal` aborts when the client
 * cancels the call, and a cancelled read gets no second try.
 */
async function callTool(
  tool: Tool,
  args: unknown,
  signal: AbortSignal,
  log: Logger,
): Promise<CallToolResult> {
  try {
    const result = await tool.call(args, { signal });
    const data = result.done ? result.outcome : result.result;
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (error) {
    if (error instanceof ToolError) return failed(error.message);
    // The client gave up on it, and won't read the answer.
    if (signal.aborted) return failed(`${tool.name} was cancelled.`);
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
