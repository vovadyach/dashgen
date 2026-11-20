// What Claude answers: a short note, then a tool call with its own ID.
export const CLAUDE_CONTENT = [
  { type: "text", text: "Checking the names first.", citations: null },
  {
    type: "tool_use",
    id: "toolu_01",
    name: "list_services",
    input: {},
    caller: { type: "direct" },
  },
];
export const CLAUDE_ANSWER = {
  id: "msg_01",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  content: CLAUDE_CONTENT,
  stop_reason: "tool_use",
  stop_sequence: null,
  stop_details: null,
  usage: {
    input_tokens: 812,
    output_tokens: 65,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
};

/** Claude's answer with these blocks and this stop reason, and the usage above. */
export const claudeAnswer = (content: unknown[], stopReason: string) => ({
  ...CLAUDE_ANSWER,
  content,
  stop_reason: stopReason,
});
