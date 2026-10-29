import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const app = await buildApp(loadConfig(), { logger: true });
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
