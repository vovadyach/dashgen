import { createGeminiModel } from "./agent/index.ts";
import { buildApp } from "./app.ts";
import { createCapTable, createDailyCap } from "./cap/index.ts";
import { loadConfig, loadDatabaseUrl, loadDynamoEndpoint } from "./config.ts";
import { createDb } from "./db.ts";
import { createDynamo } from "./dynamo.ts";
import { createMetrics } from "./metrics/index.ts";
import { saveRun } from "./runs/index.ts";

const config = loadConfig();
const databaseUrl = loadDatabaseUrl();
const dynamoEndpoint = loadDynamoEndpoint();

// DynamoDB Local keeps its tables in memory, so after each restart the backend
// makes the daily cap's table again before it takes questions. On AWS,
// Terraform will make it (step 5).
const dynamo = createDynamo(dynamoEndpoint);
try {
  await createCapTable(dynamo);
} catch (error) {
  throw new Error(
    `DynamoDB Local isn't answering at ${dynamoEndpoint}. Start it with \`make db\`.`,
    { cause: error },
  );
}

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
      metrics: (now, runLog, deadline) =>
        createMetrics(db, { now, log: runLog, signal: deadline }),
      save: (run, runLog) => saveRun(db, run, { log: runLog }),
      cap: createDailyCap(dynamo, { limit: config.dailyCap }),
      close: async () => {
        await db.$client.end();
        dynamo.destroy();
      },
    };
  },
});
await app.listen({ host: config.host, port: config.port });

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
