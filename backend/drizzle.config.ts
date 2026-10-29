import { defineConfig } from "drizzle-kit";

// `npx drizzle-kit generate --name <change>` compares these schemas with the
// last snapshot in ./drizzle and writes the difference as a SQL migration.
// drizzle-kit loads the .env in its working directory on its own. `generate`
// needs no settings, so the db:generate script points it at /dev/null instead
// (DOTENV_CONFIG_PATH), and the secrets in backend/.env are never read.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/metrics/schema.ts", "./src/runs/schema.ts"],
  out: "./drizzle",
});
