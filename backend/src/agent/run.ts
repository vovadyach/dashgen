import { setTimeout as sleep } from "node:timers/promises";

import type { Outcome } from "@dashgen/contracts";

import { consoleLogger, type Logger } from "../logger.ts";
import type { Metrics } from "../metrics/index.ts";
import { ModelError, ToolError } from "./errors.ts";
import { instructions } from "./instructions.ts";
import { createTools, EXAMPLE_QUESTIONS } from "./tools.ts";
import type {
  Message,
  Model,
  ModelReply,
  RunEnd,
  RunErrorCode,
  RunEvent,
  RunResult,
  RunStep,
  Tool,
  ToolCall,
  ToolOutput,
  ToolResult,
  ToolStep,
  Usage,
} from "./types.ts";

/**
 * What one question may use (docs/design.md, the daily cap). Each request also
 * has its own timeout and output limit, set in the model.
 */
export const RUN_LIMITS = {
  /** Requests to the model, retries included. */
  modelCalls: 6,
  /** Across all of a run's requests, since each resends the conversation so far. */
  inputTokens: 24_000,
  /** Under CloudFront's 30 seconds (ADR-0003). */
  ms: 25_000,
};

// What visitors read when a run fails, or a filter blocks the question.
const MESSAGES = {
  agentFailed: "DashGen couldn't answer that. Try asking it another way.",
  modelDown: "Gemini can't answer right now. Try again in a moment.",
  metricsDown: "The metrics are unavailable right now. Try again in a moment.",
  timeout: "That took too long. Try again, or ask something simpler.",
  blocked:
    "DashGen can't help with that. It charts the errors and latency of a few sample services.",
};

export interface RunOptions {
  model: Model;
  /**
   * Makes this run's metrics module with the clock it's given: the run's
   * start, fixed, so every query covers the same window, even seconds apart.
   */
  metrics: (now: () => Date) => Metrics;
  log?: Logger;
  /** Gets each event as it happens: a step per tool call, then how the run ended. */
  onEvent?: (event: RunEvent) => void;
  /** The clock, so tests can fix it. */
  now?: () => Date;
  /** The run's deadline, so tests can shorten it. */
  timeoutMs?: number;
  /** The wait before retrying a request, so tests can skip it. */
  retryDelayMs?: () => number;
}

/** Short and random, so retries from many runs don't all land at once. */
const randomDelay = () => 500 + Math.random() * 1_000;

/** About 4 characters a token: only to estimate the next request before Gemini counts it. */
const estimateTokens = (value: unknown) =>
  Math.ceil(JSON.stringify(value).length / 4);

const msSince = (start: number) => Math.round(performance.now() - start);

/**
 * Answers one question: sends it to the model with the tools, runs the calls
 * the model makes, sends their outputs back, and repeats until a tool ends the
 * run or a limit does. Resolves with how it ended, failures included, since
 * the page gets those as events too. Rejects only on a bug in DashGen.
 *
 * Each request gets one more try, whatever went wrong: after a short random
 * wait when Gemini fails in a way retrying can fix, at once after a reply
 * without a tool call. A blocked question ends as a decline right away, since
 * asking again gets the same block.
 */
export async function runAgent(
  question: string,
  {
    model,
    metrics,
    log = consoleLogger(),
    onEvent,
    now = () => new Date(),
    timeoutMs = RUN_LIMITS.ms,
    retryDelayMs = randomDelay,
  }: RunOptions,
): Promise<RunResult> {
  const started = performance.now();
  const startedAt = now();
  const tools = createTools(metrics(() => startedAt));
  const signal = AbortSignal.timeout(timeoutMs);
  // A function, so TypeScript doesn't assume it stays as it was last checked.
  const timeUp = () => signal.aborted;
  const system = instructions(startedAt);
  const messages: Message[] = [{ role: "user", text: question }];
  const steps: RunStep[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let modelCalls = 0;
  let retried = false;
  // Each request resends the conversation, so it's estimated from the last one.
  let nextInput = 0;
  let refusedCharts = 0;

  /** Ends the run: its last event, one log line, and the result to save. */
  const end = (last: RunEnd, details: object = {}): RunResult => {
    onEvent?.(last);
    const ms = msSince(started);
    const context = { ...details, modelCalls, ...usage, ms };
    if (last.type === "outcome") {
      log.info({ outcome: last.outcome, ...context }, "run finished");
    } else if (last.code === "unavailable") {
      log.error({ code: last.code, ...context }, "run failed");
    } else {
      log.warn({ code: last.code, ...context }, "run failed");
    }
    return { end: last, steps, model: model.name, usage, ms };
  };
  const fail = (code: RunErrorCode, message: string, details: object) =>
    end({ type: "error", code, message }, details);
  const timedOut = () => fail("timeout", MESSAGES.timeout, { timeoutMs });
  const record = (step: ToolStep) => {
    steps.push({ type: "tool", ...step });
    onEvent?.({ type: "step", ...step });
    log.debug(step, "tool call");
  };

  for (;;) {
    if (timeUp()) return timedOut();
    if (modelCalls === RUN_LIMITS.modelCalls) {
      return fail("agent_failed", MESSAGES.agentFailed, {
        reason: "no model calls left",
      });
    }
    if (usage.inputTokens + nextInput > RUN_LIMITS.inputTokens) {
      return fail("agent_failed", MESSAGES.agentFailed, {
        reason: "no input tokens left",
        nextInput,
      });
    }

    modelCalls += 1;
    const asked = performance.now();
    let reply: ModelReply;
    try {
      reply = await model.next({ system, messages, tools, signal });
    } catch (error) {
      if (timeUp()) {
        steps.push({ type: "model", ms: msSince(asked), error: "timed out" });
        return timedOut();
      }
      // Anything else is a bug in DashGen, like a conversation Gemini would refuse.
      if (!(error instanceof ModelError)) throw error;
      steps.push({ type: "model", ms: msSince(asked), error: error.message });
      if (!error.retryable || retried) {
        return fail("unavailable", MESSAGES.modelDown, { err: error });
      }
      retried = true;
      log.warn({ err: error }, "model call failed, retrying");
      try {
        await sleep(retryDelayMs(), undefined, { signal });
      } catch (waitError) {
        if (timeUp()) return timedOut();
        throw waitError;
      }
      continue;
    }

    usage.inputTokens += reply.usage.inputTokens;
    usage.outputTokens += reply.usage.outputTokens;
    const step = {
      calls: reply.calls.map((call) => call.name),
      finishReason: reply.finishReason,
      ...reply.usage,
      ms: msSince(asked),
    };
    steps.push({ type: "model", ...step });
    log.debug({ ...step, retry: retried }, "model call");

    if (reply.calls.length === 0) {
      if (reply.blocked) {
        return end(
          {
            type: "outcome",
            outcome: "decline",
            message: MESSAGES.blocked,
            examples: [...EXAMPLE_QUESTIONS],
          },
          { reason: "blocked", finishReason: reply.finishReason },
        );
      }
      if (retried) {
        return fail("agent_failed", MESSAGES.agentFailed, {
          reason: "no tool call",
          finishReason: reply.finishReason,
        });
      }
      // The same request once more.
      retried = true;
      nextInput = reply.usage.inputTokens;
      continue;
    }
    retried = false;

    messages.push({ role: "model", reply });
    const outputs: ToolOutput[] = [];
    // In order, one at a time, so a later call can use an earlier one's result.
    for (const call of reply.calls) {
      const calledAt = performance.now();
      let called: Called;
      try {
        called = await callTool(tools, call);
      } catch (error) {
        // Not the model's mistake, so most likely the database.
        record({
          tool: call.name,
          args: call.args,
          error: "failed",
          ms: msSince(calledAt),
        });
        return fail("unavailable", MESSAGES.metricsDown, {
          err: error,
          tool: call.name,
        });
      }
      record(called.step);
      if ("outcome" in called) {
        return end({ type: "outcome", ...called.outcome });
      }
      outputs.push(called.output);
      if ("error" in called.output && call.name === "create_chart") {
        refusedCharts += 1;
        // The model had one more try, with the reason it was refused.
        if (refusedCharts === 2) {
          return fail("agent_failed", MESSAGES.agentFailed, {
            reason: "chart refused twice",
          });
        }
      }
      if (timeUp()) return timedOut();
    }
    messages.push({ role: "tools", outputs });
    nextInput =
      reply.usage.inputTokens +
      reply.usage.outputTokens +
      estimateTokens(outputs);
  }
}

type Called =
  { step: ToolStep; output: ToolOutput } | { step: ToolStep; outcome: Outcome };

/** Runs one call. A ToolError becomes an error output for the model to correct; anything else rejects. */
async function callTool(tools: Tool[], call: ToolCall): Promise<Called> {
  const started = performance.now();
  const failed = (message: string): Called => ({
    step: {
      tool: call.name,
      args: call.args,
      error: message,
      ms: msSince(started),
    },
    output: { call, error: message },
  });

  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    return failed(
      `Unknown tool "${call.name}". Use one of: ${tools.map((t) => t.name).join(", ")}.`,
    );
  }
  let result: ToolResult;
  try {
    result = await tool.call(call.args);
  } catch (error) {
    if (error instanceof ToolError) return failed(error.message);
    throw error;
  }
  const step = {
    tool: call.name,
    args: call.args,
    result: result.step,
    ms: msSince(started),
  };
  return result.done
    ? { step, outcome: result.outcome }
    : { step, output: { call, result: result.result } };
}
