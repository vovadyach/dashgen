import { RunEvent } from "@dashgen/contracts";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer } from "react";

import { ApiError, ask } from "./api.ts";

export type Step = Extract<RunEvent, { type: "step" }>;
export type Answer = Extract<RunEvent, { type: "outcome" }>;

/** Why a question got no answer: one of the API's codes, and a message that's safe to show. */
export interface Failure {
  code: string;
  message: string;
}

/**
 * A question on its way to an answer, as the page shows it. Until the new
 * answer arrives, `previous` keeps the last one, which the page shows dimmed,
 * so it never goes blank.
 */
export type Run =
  | { status: "idle" }
  | { status: "asking"; question: string; previous?: Answer }
  | {
      status: "streaming";
      question: string;
      runId: string;
      steps: Step[];
      previous?: Answer;
    }
  | { status: "answered"; question: string; steps: Step[]; answer: Answer }
  | { status: "failed"; question: string; steps: Step[]; failure: Failure }
  /** The visitor stopped it. The backend still finishes the run. */
  | { status: "stopped"; question: string; steps: Step[]; previous?: Answer };

export type Action =
  | { type: "ask"; question: string }
  | { type: "started"; runId: string }
  | { type: "event"; event: RunEvent }
  | { type: "failed"; failure: Failure }
  | { type: "stop" };

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
 * so a late one, like an event from a stream that's closing, changes nothing.
 */
export function nextRun(run: Run, action: Action): Run {
  switch (action.type) {
    case "ask":
      return {
        status: "asking",
        question: action.question,
        previous: lastAnswer(run),
      };
    case "started":
      return run.status === "asking"
        ? { ...run, status: "streaming", runId: action.runId, steps: [] }
        : run;
    case "event": {
      if (run.status !== "streaming") return run;
      const { event } = action;
      const { question, steps } = run;
      if (event.type === "step") return { ...run, steps: [...steps, event] };
      if (event.type === "outcome") {
        return { status: "answered", question, steps, answer: event };
      }
      const failure = { code: event.code, message: event.message };
      return { status: "failed", question, steps, failure };
    }
    case "failed":
    case "stop": {
      if (run.status !== "asking" && run.status !== "streaming") return run;
      const { question, previous } = run;
      const steps = run.status === "streaming" ? run.steps : [];
      return action.type === "stop"
        ? { status: "stopped", question, steps, previous }
        : { status: "failed", question, steps, failure: action.failure };
    }
  }
}

/** The answer the page shows now, if any, to keep while the next question runs. */
function lastAnswer(run: Run): Answer | undefined {
  switch (run.status) {
    case "idle":
    case "failed":
      return undefined;
    case "answered":
      return run.answer;
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
  // A failed POST /api/ask is never retried by itself: each one starts, and
  // pays for, a run.
  const { mutate } = useMutation({
    mutationFn: ask,
    retry: false,
    // Send it even when the browser says it's offline. By default TanStack
    // Query would hold it, leave the page waiting, and send it by itself
    // once the browser is back online, maybe hours later.
    networkMode: "always",
    onMutate: (question) => {
      dispatch({ type: "ask", question });
    },
    onSuccess: (runId) => {
      dispatch({ type: "started", runId });
    },
    onError: (error) => {
      const failure =
        error instanceof ApiError
          ? { code: error.code, message: error.message }
          : { code: BROKEN.code, message: BROKEN.message };
      dispatch({ type: "failed", failure });
    },
  });

  const runId = run.status === "streaming" ? run.runId : undefined;
  useEffect(() => {
    if (runId === undefined) return;
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.onmessage = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      // The run is over. Closing now keeps EventSource from reconnecting
      // when the backend ends the stream.
      if (event.type !== "step") source.close();
      dispatch({ type: "event", event });
    };
    source.onerror = () => {
      // After a dropped connection, EventSource reconnects by itself, with
      // Last-Event-ID. CLOSED means it gave up, after an answer that isn't a
      // stream. Locally that's the backend's 404 for a run it no longer has.
      // Through CloudFront it could also be a passing 502 (step 5).
      if (source.readyState === EventSource.CLOSED) {
        dispatch({ type: "failed", failure: INTERRUPTED });
      }
    };
    return () => {
      source.close();
    };
  }, [runId]);

  // Stopping closes the stream, since the run's ID goes. The backend still
  // finishes the run, within its limits, and saves it.
  const stop = useCallback(() => {
    dispatch({ type: "stop" });
  }, []);

  return {
    run,
    ask: (question: string) => {
      mutate(question);
    },
    stop,
  };
}
