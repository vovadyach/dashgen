import type { TestContext } from "node:test";

import { buildApp, type AppOptions } from "../../src/app.ts";
import { NO_BOT_CHECK } from "../../src/bots/index.ts";
import { loadConfig } from "../../src/config.ts";
import { VALID_ENV } from "../fixtures/config.ts";
import { fakeMetrics } from "./metrics.ts";
import { decliningModel } from "./model.ts";

/**
 * Builds the backend with test settings, and closes it when the test ends.
 * Runs get fakes unless the test passes its own: a model that declines every
 * question, a save that keeps nothing, a daily cap that's never reached, no
 * bot check, and no database to close. `env` adds settings to the test ones.
 */
export async function startApp(
  t: TestContext,
  runs: Partial<ReturnType<AppOptions["runs"]>> = {},
  {
    env = {},
    ...options
  }: Omit<AppOptions, "runs"> & { env?: Record<string, string> } = {},
) {
  const app = await buildApp(loadConfig({ ...VALID_ENV, ...env }), {
    ...options,
    runs: () => ({
      model: decliningModel(),
      metrics: () => fakeMetrics(),
      save: () => Promise.resolve(),
      cap: { limit: 150, reserve: () => Promise.resolve({ reserved: true }) },
      botCheck: NO_BOT_CHECK,
      ...runs,
    }),
  });
  t.after(() => app.close());
  return app;
}
