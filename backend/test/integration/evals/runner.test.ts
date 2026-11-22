import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { type EvalCase, NOW } from "../../../evals/cases.ts";
import {
  EvalSetupError,
  readRows,
  runEval,
  summarize,
} from "../../../evals/runner.ts";
import { ModelError } from "../../../src/agent/errors.ts";
import type { Model } from "../../../src/agent/types.ts";
import { seedMetrics } from "../../../src/metrics/seed.ts";
import { createTestDb, type TestDb } from "../../helpers/db.ts";
import { findCase } from "../../helpers/evals.ts";
import { recordingLogger } from "../../helpers/logger.ts";
import {
  busyError,
  declineReply,
  emptyReply,
  fakeModel,
  reply,
} from "../../helpers/model.ts";

let testDb: TestDb | undefined;
const dirs: string[] = [];

before(async () => {
  testDb = await createTestDb();
  await seedMetrics(testDb.db, NOW);
});

after(async () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  await testDb?.drop();
});

/** A results folder of its own, so no test depends on another. */
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "dashgen-eval-"));
  dirs.push(dir);
  return dir;
};

// A right chart, a reply cut off twice, a refusal, the model's API failing
// twice, and a request the provider refused after a first reply.
const CASE_IDS = ["c01", "c05", "c25", "c20", "c09"];
const cases = CASE_IDS.map(findCase);

/** What the fake model answers, case by case, in that order. */
const firstScript = () => [
  reply([
    "query_metrics",
    { service: "payments-service", metric: "errors", days: 7 },
  ]),
  reply([
    "create_chart",
    {
      type: "line",
      sources: ["q1"],
      title: "Errors per day, payments-service, last 7 days",
    },
  ]),
  emptyReply("max_tokens"),
  emptyReply("max_tokens"),
  declineReply(),
  busyError(),
  busyError(),
  // After a reply, a refused request is the run's own failure, so it's scored.
  reply(["list_services"]),
  new ModelError("Claude answered 400: invalid request", {
    retryable: false,
    status: 400,
  }),
];

const evalWith = (
  dir: string,
  model: Model,
  {
    runCases = cases,
    onStart,
  }: {
    runCases?: EvalCase[];
    onStart?: (todo: number, done: number) => void;
  } = {},
) => {
  assert.ok(testDb);
  return runEval({
    model,
    price: { input: 1, output: 2 },
    db: testDb.db,
    cases: runCases,
    reps: 1,
    // One at a time, so the runs take the script's replies in order.
    concurrency: 1,
    dir,
    log: recordingLogger().log,
    retryDelayMs: () => 0,
    ...(onStart ? { onStart } : {}),
  });
};

describe("runEval", () => {
  it("writes a graded row per run, and keeps only the API's failures out of the score", async () => {
    const dir = freshDir();
    await evalWith(dir, fakeModel(firstScript()));

    const rows = readRows(dir);
    assert.deepEqual(
      rows.map((row) => [row.prompt_id, row.grade.correct, row.cut_off]),
      [
        [findCase("c01").id, 1, 0],
        [findCase("c05").id, 0, 1],
        [findCase("c25").id, 1, 0],
        [findCase("c09").id, 0, 0],
      ],
    );

    const [chart, cutOff, , refused] = rows;
    assert.ok(chart && cutOff && refused);
    assert.deepEqual(chart.tags, ["chart", "example"]);
    assert.equal(chart.model, "fake-model");
    assert.deepEqual(chart.usage, { input_tokens: 4_000, output_tokens: 120 });
    assert.equal(chart.cost_usd, 0.00424);
    assert.equal(chart.model_calls, 2);
    assert.equal(chart.tool_calls, 2);
    assert.equal(chart.max_out_tokens, 60);
    assert.equal(cutOff.meta.ended, "error agent_failed");
    assert.equal(cutOff.stop_reason, "max_tokens");
    assert.match(
      refused.explanation.outcome ?? "",
      /got error unavailable\. The model call failed: Claude answered 400/,
    );

    const errors = readFileSync(join(dir, "errors.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(errors, [
      {
        prompt_id: findCase("c20").id,
        rep: 0,
        failure_class: "api_error",
        message: "Gemini answered 503: overloaded",
        model: "fake-model",
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ]);

    // What the model got: the instructions, the question, and the query's
    // result as JSON, not the steps panel's line.
    const trace = JSON.parse(
      readFileSync(
        join(dir, "traces", `${findCase("c01").id}_rep0.json`),
        "utf8",
      ),
    ) as { role: string; content: string; name?: string }[];
    assert.deepEqual(
      trace.map((turn) => [turn.role, turn.name]),
      [
        ["system", undefined],
        ["user", undefined],
        ["tool_call", "query_metrics"],
        ["tool_result", "query_metrics"],
        ["tool_call", "create_chart"],
        ["assistant", undefined],
      ],
    );
    assert.equal(trace[1]?.content, findCase("c01").question);
    assert.match(trace[3]?.content ?? "", /"summary"/);
    assert.ok(
      existsSync(join(dir, "traces", `${findCase("c20").id}_rep0.json`)),
    );
  });

  it("goes on where the last run stopped: only the run that wasn't scored runs again", async () => {
    const dir = freshDir();
    await evalWith(dir, fakeModel(firstScript()));
    let counts: number[] = [];
    // A single reply: running any other case again would run out of script.
    await evalWith(
      dir,
      fakeModel([
        reply([
          "clarify",
          {
            message: "Which do you mean?",
            choices: [
              "Show checkout-api errors this week",
              "Show checkout-api latency this week",
            ],
          },
        ]),
      ]),
      {
        onStart: (todo, done) => {
          counts = [todo, done];
        },
      },
    );

    assert.deepEqual(counts, [1, 4]);
    const { lines, unscored } = summarize(dir, cases, 1, "fake-model");
    assert.equal(
      lines[0],
      "Correct: 3 of 5 runs (60%), on fake-model. 95% sure the true rate is 23% to 88%.",
    );
    assert.ok(
      lines.some((line) =>
        line.startsWith(`  ${findCase("c05").id}: 0 of 1 right.`),
      ),
    );
    assert.equal(unscored, 0);
  });

  it("says what failed when no run was graded", async () => {
    const dir = freshDir();
    await evalWith(dir, fakeModel([busyError(), busyError()]), {
      runCases: [findCase("c20")],
    });

    const { lines, unscored } = summarize(
      dir,
      [findCase("c20")],
      1,
      "fake-model",
    );
    assert.equal(unscored, 1);
    assert.equal(lines[0], "No graded runs yet.");
    assert.match(
      lines[1] ?? "",
      /^Not scored yet: 1 runs.*api_error, Gemini answered 503/,
    );
  });

  it("refuses to add another model's runs to these results", async () => {
    const dir = freshDir();
    await evalWith(dir, fakeModel(firstScript()));

    await assert.rejects(
      evalWith(dir, { ...fakeModel([]), name: "another-model" }),
      (error: unknown) =>
        error instanceof EvalSetupError &&
        /come from fake-model, not another-model/.test(error.message),
    );
  });

  it("keeps a run whose calls got no reply at all out of the score, as with a wrong key", async () => {
    const dir = freshDir();
    await evalWith(
      dir,
      fakeModel([
        new ModelError("Claude answered 401: invalid x-api-key", {
          retryable: false,
          status: 401,
        }),
      ]),
      { runCases: [findCase("c01")] },
    );

    assert.deepEqual(readRows(dir), []);
    const { lines, unscored } = summarize(
      dir,
      [findCase("c01")],
      1,
      "fake-model",
    );
    assert.equal(unscored, 1);
    assert.match(lines[1] ?? "", /api_error, Claude answered 401/);
  });

  it("refuses to reuse a case's rows once the case has changed", async () => {
    const dir = freshDir();
    await evalWith(dir, fakeModel(firstScript()));
    const edited = cases.map((c) =>
      c.id === findCase("c01").id
        ? { ...c, question: `${c.question}, please` }
        : c,
    );

    await assert.rejects(
      evalWith(dir, fakeModel([]), { runCases: edited }),
      (error: unknown) =>
        error instanceof EvalSetupError &&
        error.message.startsWith(`Case ${findCase("c01").id} has changed`),
    );
  });
});
