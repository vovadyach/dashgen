// What the rest of the backend may use from the agent module (ADR-0005).

export { ToolError } from "./errors.ts";
export { createModel } from "./models.ts";
export { type RunOptions, runAgent } from "./run.ts";
// The MCP server gives clients some of the same tools (ADR-0022).
export { createTools } from "./tools.ts";
export type { RunResult, Tool, Usage } from "./types.ts";
