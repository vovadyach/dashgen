import type { TestContext } from "node:test";

import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { VALID_ENV } from "../fixtures/config.ts";

/** Builds the backend with test settings, and closes it when the test ends. */
export async function startApp(t: TestContext) {
  const app = await buildApp(loadConfig(VALID_ENV));
  t.after(() => app.close());
  return app;
}
