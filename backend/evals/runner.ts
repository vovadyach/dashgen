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

import { type RunResult, runAgent } from "../src/agent/index.ts";
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
  /** `case`: the case's fingerprint, so an edited case can't reuse old rows. */
  meta: { ended: string; case: string };
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

const key = (id: string, rep: number) => `${id}#${String(rep)}`;

/**
 * Runs each case `reps` times, CONCURRENCY at a time, and writes a row per
 * graded run. Runs already in results.jsonl are skipped, so a second call
 * goes on where the last one stopped. Results from another model, or from
 * a case since edited, stop it with an EvalSetupError instead.
 */
export async function runEval(options: EvalOptions): Promise<void> {
  const { cases, reps, concurrency, dir } = options;
  mkdirSync(join(dir, "traces"), { recursive: true });
  const rows = readRows(dir);
  checkRows(rows, cases, options.model.name);
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
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      await runOne(options, job.c, job.rep, metrics);
      finished += 1;
      options.onRun?.(finished);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, work));
}

/** Refuses to add to rows that another model wrote, or that an edited case's old version wrote. */
function checkRows(rows: Row[], cases: EvalCase[], modelName: string): void {
  const other = rows.find((row) => row.model !== modelName);
  if (other) {
    throw new EvalSetupError(
      `These results come from ${other.model}, not ${modelName}. Run with --fresh to start over, or keep them and use another --variant.`,
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
): Promise<void> {
  const { db, dir, log, price, retryDelayMs } = options;
  // What the model saw and said, for the trace.
  const requests: ModelRequest[] = [];
  const replies: ModelReply[] = [];
  const model: Model = {
    name: options.model.name,
    next: async (request) => {
      requests.push({ ...request, messages: [...request.messages] });
      const reply = await options.model.next(request);
      replies.push(reply);
      return reply;
    },
  };
  const traceFile = join(dir, "traces", `${c.id}_rep${String(rep)}.json`);
  const writeTrace = (result?: RunResult) => {
    writeFileSync(
      traceFile,
      `${JSON.stringify(trace(c, requests, replies, result), null, 2)}\n`,
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
    writeTrace();
    const failure = error instanceof CeilingError ? "timeout" : "harness_error";
    appendError(dir, c, rep, failure, errorText(error));
    return;
  }

  // The provider failing a call, and its one retry, is its own trouble, not
  // the agent's. Any other failure, like a request the provider refused or a
  // tool that broke, is the agent's or DashGen's, so it's scored.
  const failedStep = result.steps.findLast(isFailed);
  const lastTwo = result.steps.slice(-2);
  if (
    result.end.type === "error" &&
    result.end.code === "unavailable" &&
    lastTwo.length === 2 &&
    lastTwo.every((s) => s.type === "model" && "error" in s)
  ) {
    writeTrace(result);
    appendError(dir, c, rep, "api_error", failedStep?.error, result);
    return;
  }

  let graded: Awaited<ReturnType<typeof gradeRun>>;
  try {
    graded = await gradeRun(c, result, metrics);
  } catch (error) {
    // Like the database failing while the grader builds the right chart.
    writeTrace(result);
    appendError(dir, c, rep, "harness_error", errorText(error), result);
    return;
  }
  const { grade, explanation } = graded;
  if (result.end.type === "error" && failedStep && explanation.outcome) {
    explanation.outcome = `${explanation.outcome} The ${failedStep.type === "model" ? "model call" : `${failedStep.tool} call`} failed: ${failedStep.error}`;
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
    meta: { ended: endOf(result), case: fingerprint(c) },
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
  requests: ModelRequest[],
  replies: ModelReply[],
  result: RunResult | undefined,
): Turn[] {
  const last = requests.at(-1);
  const turns: Turn[] = [];
  if (last) turns.push({ role: "system", content: last.system });
  // A reply with no calls never goes back in the conversation, so the last
  // reply is added when the conversation doesn't hold it yet.
  const messages = last ? [...last.messages] : [];
  const lastReply = replies.at(-1);
  if (lastReply && requests.length === replies.length) {
    messages.push({ role: "model", reply: lastReply });
  }
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

function appendError(
  dir: string,
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

  if (rows.length === 0) {
    lines.push("No graded runs yet.");
  } else {
    const count = (id: string) =>
      rows.filter((row) => row.grade[id] === 1).length;
    const right = count("correct");
    const [low, high] = wilson(right, rows.length);
    const pct = (x: number) => `${String(Math.round(x * 100))}%`;
    const seconds = rows.map((row) => row.latency_s).sort((a, b) => a - b);
    lines.push(
      `Correct: ${String(right)} of ${String(rows.length)} runs (${pct(right / rows.length)}), on ${modelName}. 95% sure the true rate is ${pct(low)} to ${pct(high)}.`,
      METRIC_IDS.slice(1)
        .map((id) => `${id} ${String(count(id))} of ${String(rows.length)}`)
        .join(", "),
      `Cut off: ${String(rows.filter((row) => row.cut_off === 1).length)} runs. Biggest reply: ${String(Math.max(...rows.map((row) => row.max_out_tokens)))} output tokens. Seconds: median ${(seconds[Math.floor(seconds.length / 2)] ?? 0).toFixed(1)}, max ${(seconds.at(-1) ?? 0).toFixed(1)}. Cost: $${rows.reduce((sum, row) => sum + row.cost_usd, 0).toFixed(4)}.`,
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

  // errors.jsonl keeps every failed attempt; a later success replaces it.
  const scored = new Set(rows.map((row) => key(row.prompt_id, row.rep)));
  const errorsPath = join(dir, "errors.jsonl");
  const failures = existsSync(errorsPath)
    ? readFileSync(errorsPath, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map(
          (line) =>
            JSON.parse(line) as {
              prompt_id: string;
              rep: number;
              failure_class: string;
              message: string;
            },
        )
        .filter((e) => asked(e.prompt_id, e.rep))
        .filter((e) => !scored.has(key(e.prompt_id, e.rep)))
    : [];
  const unscored = new Set(failures.map((e) => key(e.prompt_id, e.rep)));
  if (unscored.size > 0) {
    lines.push(
      `Not scored yet: ${String(unscored.size)} runs, since the model's API or the runner failed. Run it again to retry them. The last reason: ${failures.at(-1)?.failure_class ?? ""}, ${failures.at(-1)?.message ?? ""}`,
    );
  }
  return { lines, unscored: unscored.size };
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
