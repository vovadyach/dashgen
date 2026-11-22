import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  evalLogger,
  EvalSetupError,
  fingerprintedFiles,
  hasRows,
  readRows,
  summarize,
} from "../../../evals/runner.ts";
import { findCase } from "../../helpers/evals.ts";

const dirs: string[] = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A results folder of its own, holding these files, each a list of lines. */
const folderWith = (files: Record<string, string[]> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "dashgen-eval-"));
  dirs.push(dir);
  for (const [name, lines] of Object.entries(files)) {
    writeFileSync(join(dir, name), `${lines.join("\n")}\n`);
  }
  return dir;
};

/** Just what a graded row needs, to be read back. */
const GRADED_ROW = {
  prompt_id: "c01-payments-errors",
  rep: 0,
  model: "fake-model",
  grade: { correct: 1 },
  explanation: {},
  meta: { ended: "chart" },
};

const without = (field: string) =>
  Object.fromEntries(
    Object.entries(GRADED_ROW).filter(([key]) => key !== field),
  );

/** A line cut off, as when a run is stopped while writing it. */
const CUT_OFF = '{"prompt_id": "c01-payments-errors", "rep": 0, "mo';

/** Whether the error is an EvalSetupError whose message matches. */
const setupError = (pattern: RegExp) => (error: unknown) =>
  error instanceof EvalSetupError && pattern.test(error.message);

describe("readRows", () => {
  it("reads back the rows this runner wrote", () => {
    const dir = folderWith({ "results.jsonl": [JSON.stringify(GRADED_ROW)] });
    assert.deepEqual(readRows(dir), [GRADED_ROW]);
  });

  it("stops with a clear message at a line it can't read, as after a run stopped while writing it", () => {
    const dir = folderWith({ "results.jsonl": [CUT_OFF] });
    assert.throws(
      () => readRows(dir),
      setupError(/^Line 1 of .+ can't be read/),
    );
  });

  it("stops with a clear message at a row this runner didn't write, like one with no meta or no grade", () => {
    for (const field of ["meta", "grade"]) {
      const dir = folderWith({
        "results.jsonl": [JSON.stringify(without(field))],
      });
      assert.throws(
        () => readRows(dir),
        setupError(/^Line 1 of .+ isn't in the form this eval runner writes/),
        field,
      );
    }
  });
});

describe("hasRows", () => {
  it("is true for graded runs, and for rows it can't read, so --fresh keeps both as a backup", () => {
    assert.ok(
      hasRows(folderWith({ "results.jsonl": [JSON.stringify(GRADED_ROW)] })),
    );
    assert.ok(hasRows(folderWith({ "results.jsonl": [CUT_OFF] })));
  });

  it("is false for a folder with no graded runs, like one a failed run left", () => {
    assert.ok(!hasRows(folderWith()));
    assert.ok(!hasRows(folderWith({ "errors.jsonl": [CUT_OFF] })));
  });
});

describe("summarize", () => {
  it("stops with a clear message at a failed attempt it can't read, rather than count the runs without it", () => {
    const dir = folderWith({ "errors.jsonl": [CUT_OFF] });
    assert.throws(
      () => summarize(dir, [findCase("c01")], 1, "fake-model"),
      setupError(/^Line 1 of .+errors\.jsonl can't be read/),
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

describe("evalLogger", () => {
  it("prints an error's own message, never the response headers it carries, since CI's log is public", () => {
    const lines: string[] = [];
    const log = evalLogger((line) => {
      lines.push(line);
    });
    const err = Object.assign(new Error("Claude answered 429: rate limited"), {
      headers: { "anthropic-organization-id": "an-organization-id" },
    });
    log.error({ code: "unavailable", err }, "run failed");
    log.warn({ err }, "model call failed, retrying");
    assert.deepEqual(lines, ["run failed: Claude answered 429: rate limited"]);
  });
});
