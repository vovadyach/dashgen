import type { RunEvent } from "@dashgen/contracts";
import { describe, expect, it } from "vitest";

import { INTERRUPTED, nextRun, parseEvent, type Run } from "../src/run.ts";
import {
  CHART,
  CHART_OUTCOME,
  QUESTION,
  RUN_ID,
  SECOND_RUN_ID,
  STEPS,
  TIMEOUT,
} from "./fixtures/run.ts";

const asking: Run = { status: "asking", askId: 1, question: QUESTION };
const streaming: Run = {
  status: "streaming",
  askId: 1,
  question: QUESTION,
  runId: RUN_ID,
  steps: [],
};
/** The run after its stream, RUN_ID's, sends `events`. */
const event = (run: Run, ...events: RunEvent[]) =>
  events.reduce(
    (current, next) =>
      nextRun(current, { type: "event", runId: RUN_ID, event: next }),
    run,
  );

describe("nextRun", () => {
  it("follows a question through its steps to its answer", () => {
    let run: Run = { status: "idle" };
    run = nextRun(run, { type: "ask", askId: 1, question: QUESTION });
    run = nextRun(run, { type: "started", askId: 1, runId: RUN_ID });
    run = event(run, ...STEPS, CHART_OUTCOME);
    expect(run).toEqual({
      status: "answered",
      question: QUESTION,
      steps: STEPS,
      answer: CHART_OUTCOME,
    });
  });

  it("ends with the stream's error event, keeping the steps so far", () => {
    expect(event(streaming, STEPS[0], TIMEOUT)).toEqual({
      status: "failed",
      question: QUESTION,
      steps: [STEPS[0]],
      failure: { code: "timeout", message: TIMEOUT.message },
    });
  });

  it("opens a saved chart, which stays one, with where its numbers came from, while the next question runs", () => {
    const saved = {
      from: "pin",
      chart: CHART,
      pinnedAt: "2026-10-31T10:00:00.000Z",
    } as const;
    let run = nextRun({ status: "idle" }, { type: "open", saved });
    expect(run).toEqual({ status: "opened", saved });
    run = nextRun(run, { type: "ask", askId: 1, question: QUESTION });
    expect(run).toEqual({
      status: "asking",
      askId: 1,
      question: QUESTION,
      previous: saved,
    });
  });

  it("opens a saved chart even over a question on its way, since the visitor chose it", () => {
    const saved = { from: "link", chart: CHART } as const;
    expect(nextRun(asking, { type: "open", saved })).toEqual({
      status: "opened",
      saved,
    });
    expect(nextRun(streaming, { type: "open", saved })).toEqual({
      status: "opened",
      saved,
    });
  });

  it("fails a question that couldn't start, with no steps", () => {
    const failure = { code: "rate_limited", message: "Try again later." };
    expect(nextRun(asking, { type: "failed", askId: 1, failure })).toEqual({
      status: "failed",
      question: QUESTION,
      steps: [],
      failure,
    });
  });

  it("ignores what comes after the run ended", () => {
    const answered = event(streaming, CHART_OUTCOME);
    expect(event(answered, STEPS[0])).toBe(answered);
    expect(
      nextRun(answered, { type: "failed", askId: 1, failure: INTERRUPTED }),
    ).toBe(answered);
  });

  it("ignores a run ID unless a question is waiting for one", () => {
    expect(
      nextRun(streaming, { type: "started", askId: 1, runId: "another" }),
    ).toBe(streaming);
  });

  it("ignores an event from another run's stream", () => {
    expect(
      nextRun(streaming, {
        type: "event",
        runId: SECOND_RUN_ID,
        event: STEPS[0],
      }),
    ).toBe(streaming);
  });

  it("keeps the last answer while the next question runs, and under its error when it fails", () => {
    const answered = event(streaming, CHART_OUTCOME);
    let run = nextRun(answered, {
      type: "ask",
      askId: 2,
      question: "Next question",
    });
    expect(run).toMatchObject({ status: "asking", previous: CHART_OUTCOME });
    run = nextRun(run, { type: "started", askId: 2, runId: RUN_ID });
    expect(run).toMatchObject({ status: "streaming", previous: CHART_OUTCOME });
    run = event(run, TIMEOUT);
    expect(run).toMatchObject({ status: "failed", previous: CHART_OUTCOME });

    // Asking again keeps it once more, until a new answer comes.
    run = nextRun(run, { type: "ask", askId: 3, question: "Once more" });
    expect(run).toMatchObject({ status: "asking", previous: CHART_OUTCOME });
    run = nextRun(run, { type: "started", askId: 3, runId: RUN_ID });
    run = event(run, CHART_OUTCOME);
    expect(run).not.toHaveProperty("previous");
  });

  it("keeps the last answer when a question can't start", () => {
    const run = nextRun(
      { ...asking, previous: CHART_OUTCOME },
      { type: "failed", askId: 1, failure: INTERRUPTED },
    );
    expect(run).toMatchObject({ status: "failed", previous: CHART_OUTCOME });
  });

  it("stops a question, keeping its steps so far and the answer before it", () => {
    const withStep = event({ ...streaming, previous: CHART_OUTCOME }, STEPS[0]);
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
    expect(nextRun(stopped, { type: "started", askId: 1, runId: RUN_ID })).toBe(
      stopped,
    );
    expect(event(stopped, STEPS[0])).toBe(stopped);
    expect(
      nextRun(stopped, { type: "failed", askId: 1, failure: INTERRUPTED }),
    ).toBe(stopped);
  });

  it("takes only the current question's reply, after one was stopped before its run started", () => {
    // A is stopped, and B asked, before A's POST /api/ask has answered.
    const stopped = nextRun(asking, { type: "stop" });
    const askingB = nextRun(stopped, {
      type: "ask",
      askId: 2,
      question: "Question B",
    });

    // A's late run ID, or late failure, isn't B's.
    expect(nextRun(askingB, { type: "started", askId: 1, runId: RUN_ID })).toBe(
      askingB,
    );
    expect(
      nextRun(askingB, { type: "failed", askId: 1, failure: INTERRUPTED }),
    ).toBe(askingB);

    // B's own run ID is followed.
    expect(
      nextRun(askingB, { type: "started", askId: 2, runId: SECOND_RUN_ID }),
    ).toMatchObject({
      status: "streaming",
      question: "Question B",
      runId: SECOND_RUN_ID,
    });
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
