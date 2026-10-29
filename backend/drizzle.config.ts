import { defineConfig } from "drizzle-kit";

// `npm run db:generate --workspace backend -- --name <change>` compares these
// schemas with the last snapshot in ./drizzle and writes the difference as a
// SQL migration. Always through that script, never `npx drizzle-kit`, which
// loads the .env in its working directory on its own: the script points it at
// /dev/null instead (DOTENV_CONFIG_PATH), so backend/.env is never read.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/metrics/schema.ts", "./src/runs/schema.ts"],
  out: "./drizzle",
});
