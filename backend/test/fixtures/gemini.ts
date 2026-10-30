import { createTools } from "../../src/agent/tools.ts";
import type { Message } from "../../src/agent/types.ts";
import { QUESTION } from "./agent.ts";

// For the adapter, only the tools' names, descriptions and schemas matter.
const unused = () => Promise.reject(new Error("not called in these tests"));
export const TOOLS = createTools({ listServices: unused, query: unused });

export const QUESTION_MESSAGE: Extract<Message, { role: "user" }> = {
  role: "user",
  text: QUESTION,
};

// What Gemini answers: a tool call, with the signature Gemini 3 wants back.
export const MODEL_CONTENT = {
  role: "model",
  parts: [
    { text: "Checking the names first.", thought: true },
    {
      functionCall: { name: "list_services", args: {} },
      thoughtSignature: "signature-1",
    },
  ],
};
export const ANSWER = {
  candidates: [{ content: MODEL_CONTENT, finishReason: "STOP" }],
  usageMetadata: {
    promptTokenCount: 812,
    candidatesTokenCount: 40,
    thoughtsTokenCount: 25,
  },
};
