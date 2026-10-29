// `npm run gemini:check`: two real requests to Gemini, to check that the key,
// the model and our request format all work before the agent relies on them:
// the question first, then the model's own reply sent back with tool results,
// which Gemini 3 accepts only with its thought signatures intact.
// `npm run gemini:check -- --json` also prints each answer as Gemini sent it.
// Its requests are billed to the key in backend/.env, so people run it, never agents.
import { createGeminiModel } from "../agent/gemini.ts";
import { createTools } from "../agent/tools.ts";
import type { Message, ModelReply, ToolOutput } from "../agent/types.ts";
import { loadGeminiSettings } from "../config.ts";
import { METRICS, SERVICES } from "../metrics/seed.ts";

const SYSTEM =
  "You are DashGen. You answer questions about the errors and latency of a few sample services by calling tools.";

// Only the tools' declarations matter: nothing runs here.
const notRun = () => Promise.reject(new Error("gemini:check runs no tools."));
const tools = createTools({ listServices: notRun, query: notRun });

/** Prints each answer as Gemini sent it, for `-- --json`. */
const printJson: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  // Reads a copy, so the SDK still gets the whole answer.
  const body = await response.clone().text();
  console.log(`Gemini sent HTTP ${String(response.status)}:\n${body}`);
  return response;
};

async function check(): Promise<void> {
  const { apiKey, model: modelName } = loadGeminiSettings();
  const model = createGeminiModel({
    apiKey: apiKey.reveal(),
    model: modelName,
    fetch: process.argv.includes("--json") ? printJson : undefined,
  });
  const messages: Message[] = [
    { role: "user", text: "Show errors for payments-service this week" },
  ];

  const ask = async (label: string): Promise<ModelReply> => {
    const started = performance.now();
    const reply = await model.next({ system: SYSTEM, messages, tools });
    const ms = Math.round(performance.now() - started);
    const { inputTokens, outputTokens } = reply.usage;
    console.log(
      `${label}: ${String(ms)} ms, ${reply.finishReason}, ${String(inputTokens)} tokens in, ${String(outputTokens)} out`,
    );
    for (const call of reply.calls) {
      console.log(`  calls ${call.name} ${JSON.stringify(call.args)}`);
    }
    if (reply.text !== "") console.log(`  says "${reply.text}"`);
    const signed = JSON.stringify(reply.raw ?? {}).includes("thoughtSignature");
    console.log(`  thought signature: ${signed ? "yes" : "no"}`);
    return reply;
  };

  console.log(`Checking ${modelName}...`);
  const first = await ask("1. The question");
  if (first.calls.length === 0) {
    throw new Error(`The model called no tool (${first.finishReason}).`);
  }
  // Answers every call, so the second request carries the whole round trip.
  const outputs: ToolOutput[] = first.calls.map((call) =>
    call.name === "list_services"
      ? {
          call,
          result: {
            services: SERVICES.map((s) => s.name),
            metrics: [...METRICS],
          },
        }
      : { call, error: "gemini:check runs no queries. Pick another tool." },
  );
  messages.push({ role: "model", reply: first }, { role: "tools", outputs });
  await ask("2. Its reply sent back, with tool results");
  console.log("Gemini works with DashGen's requests.");
}

try {
  await check();
} catch (error) {
  console.error(
    `Gemini check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
