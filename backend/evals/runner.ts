// The eval loop behind `npm run eval` (run.ts): runs the agent on each case,
// grades each answer, and writes what the report reads. It takes the model
// as an argument, so a test can run it on the fake one, for free.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { type RunResult, runAgent } from "../src/agent/index.ts";
import { instructions } from "../src/agent/instructions.ts";
import { createTools } from "../src/agent/tools.ts";
import type {
  Model,
  ModelReply,
  ModelRequest,
  RunStep,
} from "../src/agent/types.ts";
import type { Price } from "../src/config.ts";
import type { Db } from "../src/db.ts";
import type { Logger } from "../src/logger.ts";
import { createMetrics, type Metrics } from "../src/metrics/index.ts";
import { type EvalCase, NOW } from "./cases.ts";
import { endOf, gradeRun, METRIC_IDS } from "./grade.ts";

/** Past the run's own 25 seconds, for a run that hangs anyway. */
export const CEILING_MS = 60_000;

export interface EvalOptions {
  model: Model;
  price: Price;
  /** Seeded at NOW (cases.ts). */
  db: Db;
  cases: EvalCase[];
  reps: number;
  concurrency: number;
  /** The variant's folder, like .claude/hillclimb/agent/baseline. */
  dir: string;
  log: Logger;
  /** The wait before the agent tries a model call again, so tests can skip it. */
  retryDelayMs?: () => number;
  /** Before the first run: how many runs are left, and how many were already done. */
  onStart?: (todo: number, done: number) => void;
  /** After each run. */
  onRun?: (finished: number) => void;
  /** Fires on Ctrl+C: no run starts after it, and a run still going writes nothing. */
  signal?: AbortSignal;
}

/** Results that can't be added to, like another model's: the message says what to do. */
export class EvalSetupError extends Error {}

/** One graded run, as results.jsonl keeps it. */
export interface Row {
  prompt_id: string;
  prompt: string;
  tags: string[];
  rep: number;
  status: "ok";
  stop_reason: string | null;
  grade: Record<string, number>;
  explanation: Record<string, string>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  latency_s: number;
  model_calls: number;
  tool_calls: number;
  cut_off: 0 | 1;
  max_out_tokens: number;
  cost_usd: number;
  /**
   * `case` and `agent`: fingerprints of the case and of the agent, so an
   * edited case, or new instructions or tools, can't reuse old rows. Rows that
   * an older runner wrote lack them.
   */
  meta: { ended: string; case?: string; agent?: string };
}

/** A model call that got a reply, with its tokens and why it stopped. */
type Reply = Extract<RunStep, { finishReason: string }>;
const isReply = (step: RunStep): step is Reply =>
  step.type === "model" && !("error" in step);

/** A model call or a tool call that failed, with why. */
type Failed = Extract<RunStep, { error: string }>;
const isFailed = (step: RunStep): step is Failed => "error" in step;

class CeilingError extends Error {}

/** What a case asks and expects, hashed: a change to either makes its old rows stale. */
export function fingerprint(c: EvalCase): string {
  return createHash("sha256")
    .update(JSON.stringify([c.question, c.expected, c.alsoRight ?? []]))
    .digest("hex")
    .slice(0, 12);
}

/**
 * The agent as the model meets it, hashed: its instructions and its tools'
 * descriptions and arguments. A change to either makes old rows stale.
 */
export function agentFingerprint(): string {
  const notRun = () =>
    Promise.reject(new Error("The fingerprint runs no tool."));
  const tools = createTools({ listServices: notRun, query: notRun }).map(
    (tool) => ({
      name: tool.name,
      description: tool.description,
      args: z.toJSONSchema(tool.args),
    }),
  );
  return createHash("sha256")
    .update(JSON.stringify([instructions(NOW), tools]))
    .digest("hex")
    .slice(0, 12);
}

const key = (id: string, rep: number) => `${id}#${String(rep)}`;

/**
 * Runs each case `reps` times, CONCURRENCY at a time, and writes a row per
 * graded run. Runs already in results.jsonl are skipped, so a second call
 * goes on where the last one stopped. Results from another model, from a
 * changed agent, or from a case since edited stop it with an EvalSetupError.
 */
export async function runEval(options: EvalOptions): Promise<void> {
  const { cases, reps, concurrency, dir } = options;
  mkdirSync(join(dir, "traces"), { recursive: true });
  const rows = readRows(dir);
  const agent = agentFingerprint();
  checkRows(rows, cases, options.model.name, agent);
  const metrics = createMetrics(options.db, {
    now: () => NOW,
    log: options.log,
  });

  const wanted = cases.flatMap((c) =>
    Array.from({ length: reps }, (_, rep) => ({ c, rep })),
  );
  const done = new Set(rows.map((row) => key(row.prompt_id, row.rep)));
  const jobs = wanted.filter(({ c, rep }) => !done.has(key(c.id, rep)));
  options.onStart?.(jobs.length, wanted.length - jobs.length);

  let finished = 0;
  const work = async () => {
    for (
      let job = jobs.shift();
      job && !options.signal?.aborted;
      job = jobs.shift()
    ) {
      await runOne(options, job.c, job.rep, metrics, agent);
      finished += 1;
      options.onRun?.(finished);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, work));
}

/** Refuses to add to rows that another model, another version of the agent, or an edited case's old version wrote. */
function checkRows(
  rows: Row[],
  cases: EvalCase[],
  modelName: string,
  agent: string,
): void {
  const other = rows.find((row) => row.model !== modelName);
  if (other) {
    throw new EvalSetupError(
      `These results come from ${other.model}, not ${modelName}. Run with --fresh to start over, or keep them and use another --variant.`,
    );
  }
  if (rows.some((row) => !row.meta.case || !row.meta.agent)) {
    throw new EvalSetupError(
      "These results were written by an older version of the eval runner, which didn't fingerprint each case and the agent. Run with --fresh to start over.",
    );
  }
  if (rows.some((row) => row.meta.agent !== agent)) {
    throw new EvalSetupError(
      "The agent's instructions or tools have changed since these results were written. Run with --fresh to start over, or use another --variant to compare the two.",
    );
  }
  for (const c of cases) {
    const print = fingerprint(c);
    const stale = rows.find(
      (row) => row.prompt_id === c.id && row.meta.case !== print,
    );
    if (stale) {
      throw new EvalSetupError(
        `Case ${c.id} has changed since its results were written. Run with --fresh to grade every case the same way.`,
      );
    }
  }
}

/** Runs one case once, and writes its row, or why it couldn't be scored. */
async function runOne(
  options: EvalOptions,
  c: EvalCase,
  rep: number,
  metrics: Metrics,
  agent: string,
): Promise<void> {
  const { db, dir, log, price, retryDelayMs } = options;
  // What the model saw and said, for the trace: the last request, and its
  // reply when it got one.
  let lastRequest: ModelRequest | undefined;
  let lastReply: ModelReply | undefined;
  const model: Model = {
    name: options.model.name,
    next: async (request) => {
      lastRequest = { ...request, messages: [...request.messages] };
      lastReply = undefined;
      const reply = await options.model.next(request);
      lastReply = reply;
      return reply;
    },
  };
  const traceFile = join(dir, "traces", `${c.id}_rep${String(rep)}.json`);
  const writeTrace = (result?: RunResult) => {
    writeFileSync(
      traceFile,
      `${JSON.stringify(trace(c, lastRequest, lastReply, result), null, 2)}\n`,
    );
  };

  let result: RunResult;
  try {
    result = await withCeiling(
      runAgent(c.question, {
        model,
        metrics: (now, runLog, deadline) =>
          createMetrics(db, { now, log: runLog, signal: deadline }),
        log,
        now: () => NOW,
        ...(retryDelayMs ? { retryDelayMs } : {}),
      }),
    );
  } catch (error) {
    // After Ctrl+C, the run fails on the closed database: nothing to keep.
    if (options.signal?.aborted) return;
    writeTrace();
    const failure = error instanceof CeilingError ? "timeout" : "harness_error";
    appendError(dir, price, c, rep, failure, errorText(error));
    return;
  }
  if (options.signal?.aborted) return;

  // A run that ends unavailable failed outside the agent: the model's API,
  // when its last failed step is a model call, or the database, when it's a
  // tool call. That's no answer, so it's never scored: it goes to
  // errors.jsonl, the eval exits with 1, and the next run tries it again.
  const lastStep = result.steps.at(-1);
  if (result.end.type === "error" && result.end.code === "unavailable") {
    const failedStep = result.steps.findLast(isFailed);
    writeTrace(result);
    if (failedStep?.type === "tool") {
      const why = `${failedStep.tool} ${failedStep.error}`;
      appendError(dir, price, c, rep, "harness_error", why, result);
    } else {
      appendError(dir, price, c, rep, "api_error", failedStep?.error, result);
    }
    return;
  }

  let graded: Awaited<ReturnType<typeof gradeRun>>;
  try {
    graded = await gradeRun(c, result, metrics);
  } catch (error) {
    if (options.signal?.aborted) return;
    // Like the database failing while the grader builds the right chart.
    writeTrace(result);
    appendError(dir, price, c, rep, "harness_error", errorText(error), result);
    return;
  }
  if (options.signal?.aborted) return;
  const { grade, explanation } = graded;
  // Only the step that ended the run explains it: an earlier failed call may
  // be one the model then corrected.
  if (
    result.end.type === "error" &&
    lastStep &&
    isFailed(lastStep) &&
    explanation.outcome
  ) {
    explanation.outcome = `${explanation.outcome} The ${lastStep.type === "model" ? "model call" : `${lastStep.tool} call`} failed: ${lastStep.error}`;
  }

  writeTrace(result);
  const modelCalls = result.steps.filter((s) => s.type === "model").length;
  const answered = result.steps.filter(isReply);
  const row: Row = {
    prompt_id: c.id,
    prompt: c.question,
    tags: [c.expected.outcome, c.source],
    rep,
    // A cut-off reply is a failure visitors see, so it's scored, not left out.
    status: "ok",
    stop_reason: answered.at(-1)?.finishReason ?? null,
    grade,
    explanation,
    model: result.model,
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
    },
    latency_s: result.ms / 1000,
    model_calls: modelCalls,
    tool_calls: result.steps.length - modelCalls,
    cut_off: answered.some((s) => /^max_tokens$/i.test(s.finishReason)) ? 1 : 0,
    max_out_tokens: Math.max(0, ...answered.map((s) => s.outputTokens)),
    cost_usd: costOf(result, price),
    meta: { ended: endOf(result), case: fingerprint(c), agent },
  };
  appendFileSync(join(dir, "results.jsonl"), `${JSON.stringify(row)}\n`);
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** In dollars, to the millionth, as the runs table keeps it. */
function costOf(result: RunResult, price: Price): number {
  const dollars =
    (result.usage.inputTokens * price.input +
      result.usage.outputTokens * price.output) /
    1_000_000;
  return Number(dollars.toFixed(6));
}

/** Fails a run that outlives the ceiling. The run itself may go on in the background. */
async function withCeiling<T>(run: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new CeilingError(`No answer in ${String(CEILING_MS / 1000)} seconds.`),
      );
    }, CEILING_MS);
  });
  try {
    return await Promise.race([run, ceiling]);
  } finally {
    clearTimeout(timer);
  }
}

interface Turn {
  role: "system" | "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  name?: string;
}

/**
 * The run's full exchange, in the report's format: the instructions and every
 * message as the model last got them, its last reply, how the run ended, and
 * each model call's tokens and time.
 */
function trace(
  c: EvalCase,
  last: ModelRequest | undefined,
  lastReply: ModelReply | undefined,
  result: RunResult | undefined,
): Turn[] {
  const turns: Turn[] = [];
  if (last) turns.push({ role: "system", content: last.system });
  // The last request's conversation doesn't hold its own reply, so that
  // reply, when it came, is added at the end.
  const messages = last ? [...last.messages] : [];
  if (lastReply) messages.push({ role: "model", reply: lastReply });
  if (messages.length === 0) messages.push({ role: "user", text: c.question });

  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ role: "user", content: message.text });
    } else if (message.role === "model") {
      if (message.reply.text) {
        turns.push({ role: "assistant", content: message.reply.text });
      }
      for (const call of message.reply.calls) {
        turns.push({
          role: "tool_call",
          name: call.name,
          content: JSON.stringify(call.args, null, 2),
        });
      }
    } else {
      for (const output of message.outputs) {
        turns.push({
          role: "tool_result",
          name: output.call.name,
          content: JSON.stringify(
            "error" in output ? { error: output.error } : output.result,
            null,
            2,
          ),
        });
      }
    }
  }

  if (result) {
    const calls = result.steps
      .filter((s) => s.type === "model")
      .map((s, i) =>
        "error" in s
          ? `${String(i + 1)}. failed after ${String(s.ms)} ms: ${s.error}`
          : `${String(i + 1)}. ${s.calls.join(", ") || "no tool"}: ${String(s.outputTokens)} output tokens, ${String(s.ms)} ms, ${s.finishReason}`,
      );
    turns.push({
      role: "assistant",
      content: `The run ended:\n${JSON.stringify(result.end, null, 2)}\n\nModel calls:\n${calls.join("\n")}`,
    });
  }
  return turns;
}

/** The variant's graded runs so far. */
export function readRows(dir: string): Row[] {
  const path = join(dir, "results.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Row);
}

/** Writes why a run wasn't scored, with what its calls cost, since a failed run is billed too. */
function appendError(
  dir: string,
  price: Price,
  c: EvalCase,
  rep: number,
  failureClass: string,
  message: string | undefined,
  result?: RunResult,
): void {
  const line = {
    prompt_id: c.id,
    rep,
    failure_class: failureClass,
    message: message ?? "unknown",
    ...(result
      ? {
          model: result.model,
          usage: {
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
          },
          cost_usd: costOf(result, price),
        }
      : {}),
  };
  appendFileSync(join(dir, "errors.jsonl"), `${JSON.stringify(line)}\n`);
}

export interface Summary {
  lines: string[];
  /** The asked-for runs that failed for another reason than the agent, and wait for another try. */
  unscored: number;
}

/** The score, how sure it is, the cases that weren't right every time, and the runs not scored yet. */
export function summarize(
  dir: string,
  cases: EvalCase[],
  reps: number,
  modelName: string,
): Summary {
  const asked = (id: string, rep: number) =>
    rep < reps && cases.some((c) => c.id === id);
  const rows = readRows(dir).filter((row) => asked(row.prompt_id, row.rep));
  const lines: string[] = [];

  // errors.jsonl keeps every failed attempt; a later success replaces it.
  const errorsPath = join(dir, "errors.jsonl");
  const attempts = existsSync(errorsPath)
    ? readFileSync(errorsPath, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as ErrorLine)
        .filter((e) => asked(e.prompt_id, e.rep))
    : [];
  const scored = new Set(rows.map((row) => key(row.prompt_id, row.rep)));
  const failures = attempts.filter((e) => !scored.has(key(e.prompt_id, e.rep)));
  // Every failed attempt was billed, even one that a later run replaced.
  const failedCost = attempts.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);

  if (rows.length === 0) {
    lines.push("No graded runs yet.");
  } else {
    const count = (id: string) =>
      rows.filter((row) => row.grade[id] === 1).length;
    const right = count("correct");
    // Counted by case, not by run: a case's runs mostly agree, so 54 runs of
    // 27 cases say about as much as 27 answers.
    const caseCount = new Set(rows.map((row) => row.prompt_id)).size;
    const [low, high] = wilson((right / rows.length) * caseCount, caseCount);
    const pct = (x: number) => `${String(Math.round(x * 100))}%`;
    const seconds = rows.map((row) => row.latency_s).sort((a, b) => a - b);
    const cost = rows.reduce((sum, row) => sum + row.cost_usd, failedCost);
    const failedPart =
      failedCost > 0
        ? `, $${failedCost.toFixed(4)} of it in runs that weren't scored`
        : "";
    lines.push(
      `Correct: ${String(right)} of ${String(rows.length)} runs (${pct(right / rows.length)}), on ${modelName}. 95% sure the true rate is ${pct(low)} to ${pct(high)}.`,
      METRIC_IDS.slice(1)
        .map((id) => `${id} ${String(count(id))} of ${String(rows.length)}`)
        .join(", "),
      `Cut off: ${String(rows.filter((row) => row.cut_off === 1).length)} runs. Biggest reply: ${String(Math.max(...rows.map((row) => row.max_out_tokens)))} output tokens. Seconds: median ${(seconds[Math.floor(seconds.length / 2)] ?? 0).toFixed(1)}, max ${(seconds.at(-1) ?? 0).toFixed(1)}. Cost: $${cost.toFixed(4)}${failedPart}.`,
    );
    for (const c of cases) {
      const runs = rows.filter((row) => row.prompt_id === c.id);
      const wrong = runs.filter((row) => row.grade.correct !== 1);
      if (wrong.length === 0) continue;
      const why = wrong.map(
        (row) => Object.values(row.explanation).join(" ") || row.meta.ended,
      );
      lines.push(
        `  ${c.id}: ${String(runs.length - wrong.length)} of ${String(runs.length)} right. ${[...new Set(why)].join(" | ")}`,
      );
    }
  }

  const unscored = new Set(failures.map((e) => key(e.prompt_id, e.rep)));
  if (unscored.size > 0) {
    lines.push(
      `Not scored yet: ${String(unscored.size)} runs, since the model's API or the runner failed. Run it again to retry them. The last reason: ${failures.at(-1)?.failure_class ?? ""}, ${failures.at(-1)?.message ?? ""}`,
    );
  }
  return { lines, unscored: unscored.size };
}

/** One failed attempt, as errors.jsonl keeps it. */
interface ErrorLine {
  prompt_id: string;
  rep: number;
  failure_class: string;
  message: string;
  /** When the run got far enough to have used tokens. */
  cost_usd?: number;
}

/** The 95% Wilson interval of a share: where the true rate likely is, given the runs. */
function wilson(right: number, n: number): [number, number] {
  const z = 1.96;
  const p = right / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const spread =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) /
    (1 + (z * z) / n);
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)];
}
