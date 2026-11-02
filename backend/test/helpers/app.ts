import type { TestContext } from "node:test";

import { buildApp, type AppOptions } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { VALID_ENV } from "../fixtures/config.ts";
import { fakeMetrics } from "./metrics.ts";
import { decliningModel } from "./model.ts";

/**
 * Builds the backend with test settings, and closes it when the test ends.
 * Runs get fakes unless the test passes its own: a model that declines every
 * question, a save that keeps nothing, a daily cap that's never reached, and
 * no database to close.
 */
export async function startApp(
  t: TestContext,
  runs: Partial<ReturnType<AppOptions["runs"]>> = {},
) {
  const app = await buildApp(loadConfig(VALID_ENV), {
    runs: () => ({
      model: decliningModel(),
      metrics: () => fakeMetrics(),
      save: () => Promise.resolve(),
      cap: { reserve: () => Promise.resolve({ reserved: true }) },
      ...runs,
    }),
  });
  t.after(() => app.close());
  return app;
}
