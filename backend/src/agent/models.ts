import type { Provider } from "../config.ts";
import { createClaudeModel } from "./claude.ts";
import { createGeminiModel } from "./gemini.ts";
import type { Model } from "./types.ts";

/** The model AI_MODEL names, with its provider and that provider's key (config.ts). */
export interface ModelChoice {
  name: string;
  provider: Provider;
  apiKey: string;
  /** Tests and `npm run model:check -- --json` pass their own. */
  fetch?: typeof fetch;
}

/** The Model for AI_MODEL, on its provider's adapter. */
export function createModel({
  name,
  provider,
  apiKey,
  fetch,
}: ModelChoice): Model {
  switch (provider) {
    case "gemini":
      return createGeminiModel({ apiKey, model: name, fetch });
    case "claude":
      return createClaudeModel({ apiKey, model: name, fetch });
  }
}
