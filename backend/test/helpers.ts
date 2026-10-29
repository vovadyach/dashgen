import type { TestContext } from "node:test";

import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

export const VALID_ENV = {
  GEMINI_API_KEY: "test-key",
  ALLOWED_ORIGINS: "http://localhost:5173",
};

/** Builds the backend with test settings, and closes it when the test ends. */
export async function startApp(t: TestContext) {
  const app = await buildApp(loadConfig(VALID_ENV));
  t.after(() => app.close());
  return app;
}
