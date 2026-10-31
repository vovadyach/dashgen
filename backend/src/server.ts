import { createGeminiModel } from "./agent/index.ts";
import { buildApp } from "./app.ts";
import { loadConfig, loadDatabaseUrl } from "./config.ts";
import { createDb } from "./db.ts";
import { createMetrics } from "./metrics/index.ts";
import { saveRun } from "./runs/index.ts";

const config = loadConfig();
const databaseUrl = loadDatabaseUrl();

const app = await buildApp(config, {
  logger: true,
  // Made here so the database's log lines go through the app's logger.
  runs: (log) => {
    const db = createDb(databaseUrl.reveal(), { log });
    return {
      model: createGeminiModel({
        apiKey: config.geminiApiKey.reveal(),
        model: config.geminiModel,
      }),
      metrics: (now, runLog) => createMetrics(db, { now, log: runLog }),
      save: (run) => saveRun(db, run),
      close: () => db.$client.end(),
    };
  },
});
await app.listen({ port: 3000 });

// ECS sends SIGTERM before it stops a task, and Ctrl+C sends SIGINT. Closing
// lets requests in flight finish, while new ones get a 503.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "closing the server");
    app.close().catch((error: unknown) => {
      app.log.error(error, "the server didn't close cleanly");
      process.exitCode = 1;
    });
  });
}
