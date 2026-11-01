import { type Chart, RunEvent } from "@dashgen/contracts";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { ApiError, ask } from "./api.ts";

export type Step = Extract<RunEvent, { type: "step" }>;
export type Answer = Extract<RunEvent, { type: "outcome" }>;

/** Why a question got no answer: one of the API's codes, and a message that's safe to show. */
export interface Failure {
  code: string;
  message: string;
}

/**
 * A chart the page shows without a run: one pinned in this browser at
 * `pinnedAt`, or one that came in a shared link. Either way, its numbers
 * came with it.
 */
export type SavedChart =
  | { from: "pin"; chart: Chart; pinnedAt: string }
  | { from: "link"; chart: Chart };

/**
 * A question on its way to an answer, as the page shows it. Until the new
 * answer arrives, `previous` keeps the last one, which the page shows dimmed,
 * so it never goes blank. A question that fails keeps it too, under its
 * error. `askId` says which ask a question is, so a late reply to an earlier
 * one, stopped before its run started, can be told apart.
 */
export type Run =
  | { status: "idle" }
  | { status: "asking"; askId: number; question: string; previous?: Answer }
  | {
      status: "streaming";
      askId: number;
      question: string;
      runId: string;
      steps: Step[];
      previous?: Answer;
    }
  | { status: "answered"; question: string; steps: Step[]; answer: Answer }
  | {
      status: "failed";
      question: string;
      steps: Step[];
      failure: Failure;
      previous?: Answer;
    }
  /** The visitor stopped it. The backend still finishes the run. */
  | { status: "stopped"; question: string; steps: Step[]; previous?: Answer }
  /** A saved chart, opened with no question asked. */
  | { status: "opened"; saved: SavedChart };

export type Action =
  | { type: "ask"; askId: number; question: string }
  | { type: "started"; askId: number; runId: string }
  | { type: "event"; runId: string; event: RunEvent }
  | { type: "failed"; askId: number; failure: Failure }
  | { type: "stop" }
  | { type: "open"; saved: SavedChart };

/** The backend no longer knows the run: it ended over 5 minutes ago, or the backend restarted. */
export const INTERRUPTED: Failure = {
  code: "run_not_found",
  message: "The answer was interrupted. Ask the question again.",
};

const BROKEN = {
  type: "error",
  code: "internal_error",
  message: "Something went wrong.",
} as const satisfies RunEvent;

/**
 * The run after `action`. An action counts only at the stage it belongs to,
 * and only for the question it belongs to, so a late one, like the reply to
 * a question that was stopped, or an event from a stream that's closing,
 * changes nothing.
 */
export function nextRun(run: Run, action: Action): Run {
  switch (action.type) {
    case "ask":
      return {
        status: "asking",
        askId: action.askId,
        question: action.question,
        previous: lastAnswer(run),
      };
    case "started":
      return run.status === "asking" && run.askId === action.askId
        ? { ...run, status: "streaming", runId: action.runId, steps: [] }
        : run;
    case "event": {
      if (run.status !== "streaming" || run.runId !== action.runId) return run;
      const { event } = action;
      const { question, steps, previous } = run;
      if (event.type === "step") return { ...run, steps: [...steps, event] };
      if (event.type === "outcome") {
        return { status: "answered", question, steps, answer: event };
      }
      const failure = { code: event.code, message: event.message };
      return { status: "failed", question, steps, failure, previous };
    }
    case "failed":
    case "stop": {
      if (run.status !== "asking" && run.status !== "streaming") return run;
      if (action.type === "failed" && action.askId !== run.askId) return run;
      const { question, previous } = run;
      const steps = run.status === "streaming" ? run.steps : [];
      return action.type === "stop"
        ? { status: "stopped", question, steps, previous }
        : {
            status: "failed",
            question,
            steps,
            failure: action.failure,
            previous,
          };
    }
    case "open":
      // A question on its way keeps the page until it ends or is stopped.
      return run.status === "asking" || run.status === "streaming"
        ? run
        : { status: "opened", saved: action.saved };
  }
}

/** The answer the page shows now, if any, to keep while the next question runs. */
function lastAnswer(run: Run): Answer | undefined {
  switch (run.status) {
    case "idle":
      return undefined;
    case "answered":
      return run.answer;
    case "opened":
      return { type: "outcome", outcome: "chart", chart: run.saved.chart };
    default:
      return run.previous;
  }
}

/** One SSE event's data. A shape the contract doesn't know is a bug, and ends the run. */
export function parseEvent(data: string): RunEvent {
  try {
    const parsed = RunEvent.safeParse(JSON.parse(data));
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON at all: the same bug.
  }
  return BROKEN;
}

/** Asks questions, and follows each one's run through its stream to its answer. */
export function useRun() {
  const [run, dispatch] = useReducer(nextRun, { status: "idle" });
  // Each ask gets the next number, and its reply comes back with it. Every
  // reply arrives, even one to a question that was stopped and replaced
  // (TanStack Query runs these callbacks for every request), so the reducer
  // takes only the current ask's.
  const asks = useRef(0);
  // A failed POST /api/ask is never retried by itself: each one starts, and
  // pays for, a run.
  const { mutate } = useMutation({
    mutationFn: ({ question }: { askId: number; question: string }) =>
      ask(question),
    retry: false,
    // Send it even when the browser says it's offline. By default TanStack
    // Query would hold it, leave the page waiting, and send it by itself
    // once the browser is back online, maybe hours later.
    networkMode: "always",
    onMutate: ({ askId, question }) => {
      dispatch({ type: "ask", askId, question });
    },
    onSuccess: (runId, { askId }) => {
      dispatch({ type: "started", askId, runId });
    },
    onError: (error, { askId }) => {
      const failure =
        error instanceof ApiError
          ? { code: error.code, message: error.message }
          : { code: BROKEN.code, message: BROKEN.message };
      dispatch({ type: "failed", askId, failure });
    },
  });

  const runId = run.status === "streaming" ? run.runId : undefined;
  const askId = run.status === "streaming" ? run.askId : undefined;
  useEffect(() => {
    if (runId === undefined || askId === undefined) return;
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.onmessage = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      // The run is over. Closing now keeps EventSource from reconnecting
      // when the backend ends the stream.
      if (event.type !== "step") source.close();
      dispatch({ type: "event", runId, event });
    };
    source.onerror = () => {
      // After a dropped connection, EventSource reconnects by itself, with
      // Last-Event-ID. CLOSED means it gave up, after an answer that isn't a
      // stream. Locally that's the backend's 404 for a run it no longer has.
      // Through CloudFront it could also be a passing 502 (step 5).
      if (source.readyState === EventSource.CLOSED) {
        dispatch({ type: "failed", askId, failure: INTERRUPTED });
      }
    };
    return () => {
      source.close();
    };
  }, [runId, askId]);

  // Stopping closes the stream, since the run's ID goes. The backend still
  // finishes the run, within its limits, and saves it.
  const stop = useCallback(() => {
    dispatch({ type: "stop" });
  }, []);

  // Shows a saved chart, with no run and no call to Gemini.
  const open = useCallback((saved: SavedChart) => {
    dispatch({ type: "open", saved });
  }, []);

  return {
    run,
    ask: (question: string) => {
      asks.current += 1;
      mutate({ askId: asks.current, question });
    },
    stop,
    open,
  };
}
