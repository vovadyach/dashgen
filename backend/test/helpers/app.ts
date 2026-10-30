import type { TestContext } from "node:test";

import type { RunDeps } from "../../src/api/runs.ts";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { VALID_ENV } from "../fixtures/config.ts";
import { fakeMetrics } from "./metrics.ts";
import { decliningModel } from "./model.ts";

/**
 * Builds the backend with test settings, and closes it when the test ends.
 * Runs get fakes unless the test passes its own: a model that declines every
 * question, and a save that keeps nothing.
 */
export async function startApp(t: TestContext, runs: Partial<RunDeps> = {}) {
  const app = await buildApp(loadConfig(VALID_ENV), {
    runs: () => ({
      model: decliningModel(),
      metrics: () => fakeMetrics(),
      save: () => Promise.resolve(),
      ...runs,
    }),
  });
  t.after(() => app.close());
  return app;
}
