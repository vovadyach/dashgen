// `npm run eval`: runs the agent on every eval case (cases.ts), on the model
// that AI_MODEL names, and grades each answer (grade.ts). Each run calls the
// model for real, billed to the key in backend/.env, so people run it, never
// agents. The sample data is seeded at a fixed time, in a fresh database on
// the test Postgres, so the right answers never change.
//
//   npm run eval                         every case, twice
//   npm run eval -- --cases c01,c05      only these cases
//   npm run eval -- --reps 1 --fresh     once each, from scratch
//
// Results go to .claude/hillclimb/agent/<variant>/: a row per run in
// results.jsonl, its full exchange in traces/, and runs that failed for
// another reason than the agent, like the model's API being down, in
// errors.jsonl, which the score leaves out. A second `npm run eval` goes on
// where the last one stopped: it skips the runs already in results.jsonl.
// It exits with 1 when a run is left unscored, as when the model's API or the
// database fails, so a wrong key can't pass.
import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createModel } from "../src/agent/index.ts";
import { loadModelSettings } from "../src/config.ts";
import { consoleLogger } from "../src/logger.ts";
import { seedMetrics } from "../src/metrics/seed.ts";
import { createTestDb, type TestDb } from "../test/helpers/db.ts";
import { CASES, NOW } from "./cases.ts";
import { EvalSetupError, runEval, summarize } from "./runner.ts";

function fail(message: string, cause?: unknown): never {
  console.error(message);
  if (cause instanceof Error) console.error(cause.message);
  process.exit(1);
}

const { values: options } = parseArgs({
  options: {
    reps: { type: "string", default: "2" },
    cases: { type: "string" },
    variant: { type: "string", default: "baseline" },
    concurrency: { type: "string", default: "3" },
    fresh: { type: "boolean", default: false },
  },
});

const reps = Number(options.reps);
const concurrency = Number(options.concurrency);
if (!Number.isInteger(reps) || reps < 1) fail("--reps must be 1 or more.");
if (!Number.isInteger(concurrency) || concurrency < 1) {
  fail("--concurrency must be 1 or more.");
}
// The report reads only these names.
if (!/^(baseline|v\d+)$/.test(options.variant)) {
  fail("--variant must be baseline, or v1, v2 and so on.");
}
// --fresh deletes every result of the variant, and --cases runs only a few.
if (options.fresh && options.cases) {
  fail(
    "--fresh deletes the variant's results for every case, so it can't go with --cases. Use another --variant to try a few cases from scratch.",
  );
}
const matches = (id: string, w: string) => id === w || id.startsWith(`${w}-`);
const wanted = options.cases?.split(",").map((id) => id.trim());
const unknown = wanted?.filter((w) => !CASES.some((c) => matches(c.id, w)));
if (unknown?.length) fail(`No case matches ${unknown.join(", ")}.`);
const cases = wanted
  ? CASES.filter((c) => wanted.some((w) => matches(c.id, w)))
  : CASES;

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, ".claude/hillclimb/agent", options.variant);

const settings = loadModelSettings();
const model = createModel({
  name: settings.name,
  provider: settings.provider,
  apiKey: settings.apiKey.reveal(),
});

let testDb: TestDb;
try {
  testDb = await createTestDb();
} catch (error) {
  fail(
    "The test Postgres isn't answering on port 5433. Start it with `docker compose --file compose.test.yaml up --detach --wait`.",
    error,
  );
}
// Drops the eval's database once, whether Ctrl+C or the finally below gets there first.
let dropping: Promise<void> | undefined;
const dropDb = () => (dropping ??= testDb.drop());
// Ctrl+C would skip the finally below, and leave the eval's database behind.
// The signal stops new runs first, and makes a run still going write nothing.
const stop = new AbortController();
process.once("SIGINT", () => {
  stop.abort();
  void dropDb().finally(() => process.exit(130));
});

try {
  // The old results move aside rather than go, so a run that fails, as with
  // an expired key, never costs them: they're in <variant>.before-fresh.
  if (options.fresh && existsSync(dir)) {
    const backup = `${dir}.before-fresh`;
    rmSync(backup, { recursive: true, force: true });
    renameSync(dir, backup);
    console.log(`The old results are in ${backup}.`);
  }
  await seedMetrics(testDb.db, NOW);
  await runEval({
    model,
    price: settings.price,
    db: testDb.db,
    cases,
    reps,
    concurrency,
    dir,
    log: consoleLogger("error"),
    signal: stop.signal,
    onStart: (todo, done) => {
      console.log(
        `${String(todo)} runs to do on ${settings.name}: ${String(cases.length)} cases × ${String(reps)}, ${String(done)} already done.`,
      );
    },
    onRun: (finished) => {
      process.stdout.write(`\r${String(finished)} done`);
    },
  });
  const { lines, unscored } = summarize(dir, cases, reps, settings.name);
  console.log(`\n${lines.join("\n")}`);
  console.log(`\nEach run's full exchange is in ${join(dir, "traces")}.`);
  if (unscored > 0) process.exitCode = 1;
} catch (error) {
  if (!(error instanceof EvalSetupError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await dropDb();
}
