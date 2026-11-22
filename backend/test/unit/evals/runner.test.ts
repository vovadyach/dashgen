import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  EvalSetupError,
  fingerprintedFiles,
  readRows,
} from "../../../evals/runner.ts";

const dirs: string[] = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A results folder of its own, holding these lines as results.jsonl. */
const resultsWith = (...lines: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), "dashgen-eval-"));
  dirs.push(dir);
  writeFileSync(join(dir, "results.jsonl"), `${lines.join("\n")}\n`);
  return dir;
};

/** Whether the error is an EvalSetupError whose message matches. */
const setupError = (pattern: RegExp) => (error: unknown) =>
  error instanceof EvalSetupError && pattern.test(error.message);

describe("readRows", () => {
  it("stops with a clear message at a line it can't read, as after a run stopped while writing it", () => {
    const dir = resultsWith(
      '{"prompt_id": "c01-payments-errors", "rep": 0, "mo',
    );
    assert.throws(
      () => readRows(dir),
      setupError(/^Line 1 of .+ can't be read/),
    );
  });

  it("stops with a clear message at a row this runner didn't write, like one with no meta", () => {
    const dir = resultsWith(
      JSON.stringify({
        prompt_id: "c01-payments-errors",
        rep: 0,
        model: "fake-model",
      }),
    );
    assert.throws(
      () => readRows(dir),
      setupError(/^Line 1 of .+ isn't a row this eval runner wrote/),
    );
  });
});

describe("fingerprintedFiles", () => {
  it("lists the agent, with its output cap and limits, the metrics and their seed, the shared schemas and the grader", () => {
    const files = fingerprintedFiles();
    for (const file of [
      "src/agent/instructions.ts",
      "src/agent/claude.ts",
      "src/agent/run.ts",
      "src/agent/validation.ts",
      "src/metrics/seed.ts",
      "../packages/contracts/src/index.ts",
      "evals/grade.ts",
    ]) {
      assert.ok(files.includes(file), `${file} isn't fingerprinted`);
    }
  });
});
