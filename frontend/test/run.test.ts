import { describe, expect, it } from "vitest";

import { INTERRUPTED, nextRun, parseEvent, type Run } from "../src/run.ts";
import {
  CHART_OUTCOME,
  QUESTION,
  RUN_ID,
  STEPS,
  TIMEOUT,
} from "./fixtures/run.ts";

const asking: Run = { status: "asking", question: QUESTION };
const streaming: Run = {
  status: "streaming",
  question: QUESTION,
  runId: RUN_ID,
  steps: [],
};

describe("nextRun", () => {
  it("follows a question through its steps to its answer", () => {
    let run: Run = { status: "idle" };
    run = nextRun(run, { type: "ask", question: QUESTION });
    run = nextRun(run, { type: "started", runId: RUN_ID });
    for (const step of STEPS)
      run = nextRun(run, { type: "event", event: step });
    run = nextRun(run, { type: "event", event: CHART_OUTCOME });
    expect(run).toEqual({
      status: "answered",
      question: QUESTION,
      steps: STEPS,
      answer: CHART_OUTCOME,
    });
  });

  it("ends with the stream's error event, keeping the steps so far", () => {
    let run = nextRun(streaming, { type: "event", event: STEPS[0] });
    run = nextRun(run, { type: "event", event: TIMEOUT });
    expect(run).toEqual({
      status: "failed",
      question: QUESTION,
      steps: [STEPS[0]],
      failure: { code: "timeout", message: TIMEOUT.message },
    });
  });

  it("fails a question that couldn't start, with no steps", () => {
    const failure = { code: "rate_limited", message: "Try again later." };
    expect(nextRun(asking, { type: "failed", failure })).toEqual({
      status: "failed",
      question: QUESTION,
      steps: [],
      failure,
    });
  });

  it("ignores what comes after the run ended", () => {
    const answered = nextRun(streaming, {
      type: "event",
      event: CHART_OUTCOME,
    });
    expect(nextRun(answered, { type: "event", event: STEPS[0] })).toBe(
      answered,
    );
    expect(nextRun(answered, { type: "failed", failure: INTERRUPTED })).toBe(
      answered,
    );
  });

  it("ignores a run ID unless a question is waiting for one", () => {
    expect(nextRun(streaming, { type: "started", runId: "another" })).toBe(
      streaming,
    );
  });

  it("keeps the last answer while the next question runs, and drops it when the new one comes", () => {
    const answered = nextRun(streaming, {
      type: "event",
      event: CHART_OUTCOME,
    });
    let run = nextRun(answered, { type: "ask", question: "Next question" });
    expect(run).toMatchObject({ status: "asking", previous: CHART_OUTCOME });
    run = nextRun(run, { type: "started", runId: RUN_ID });
    expect(run).toMatchObject({ status: "streaming", previous: CHART_OUTCOME });
    run = nextRun(run, { type: "event", event: TIMEOUT });
    expect(run).not.toHaveProperty("previous");
  });

  it("stops a question, keeping its steps so far and the answer before it", () => {
    const withStep = nextRun(
      { ...streaming, previous: CHART_OUTCOME },
      { type: "event", event: STEPS[0] },
    );
    expect(nextRun(withStep, { type: "stop" })).toEqual({
      status: "stopped",
      question: QUESTION,
      steps: [STEPS[0]],
      previous: CHART_OUTCOME,
    });
  });

  it("ignores what a stopped question's request and stream bring later", () => {
    const stopped = nextRun(asking, { type: "stop" });
    expect(stopped).toEqual({
      status: "stopped",
      question: QUESTION,
      steps: [],
    });
    expect(nextRun(stopped, { type: "started", runId: RUN_ID })).toBe(stopped);
    expect(nextRun(stopped, { type: "event", event: STEPS[0] })).toBe(stopped);
    expect(nextRun(stopped, { type: "failed", failure: INTERRUPTED })).toBe(
      stopped,
    );
  });
});

describe("parseEvent", () => {
  it("reads an event the contract knows", () => {
    expect(parseEvent(JSON.stringify(CHART_OUTCOME))).toEqual(CHART_OUTCOME);
  });

  it.each([
    ["isn't JSON", "{"],
    ["has a shape the contract doesn't know", '{"type":"progress"}'],
  ])("ends the run with internal_error when the data %s", (_, data) => {
    expect(parseEvent(data)).toEqual({
      type: "error",
      code: "internal_error",
      message: "Something went wrong.",
    });
  });
});
