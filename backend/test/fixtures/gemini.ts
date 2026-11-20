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
