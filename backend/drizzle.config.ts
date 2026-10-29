import { defineConfig } from "drizzle-kit";

// `npx drizzle-kit generate --name <change>` compares these schemas with the
// last snapshot in ./drizzle and writes the difference as a SQL migration.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/metrics/schema.ts", "./src/runs/schema.ts"],
  out: "./drizzle",
});
