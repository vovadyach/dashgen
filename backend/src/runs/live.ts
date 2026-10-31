import type { Logger } from "../logger.ts";

/** Gets a run's events as they come, each with its number, then the end. */
export interface RunListener<E> {
  event: (id: number, event: E) => void;
  end: () => void;
}

/** A run as a stream sees it: its events so far, in order, and whether more can come. */
export interface LiveRun<E> {
  readonly events: readonly E[];
  readonly ended: boolean;
}

export interface RunStore<E> {
  start: (id: string) => void;
  /** Adds the run's next event, numbered from 1, and passes it to the run's listeners. */
  add: (id: string, event: E) => void;
  /** Tells the run's listeners it's over, and forgets the run `keepMs` later. */
  end: (id: string) => void;
  get: (id: string) => LiveRun<E> | undefined;
  /** Passes the run's next events to `listener`, until the run ends or the returned function is called. */
  listen: (id: string, listener: RunListener<E>) => () => void;
}

/**
 * Keeps each run's events in memory, so a stream that reconnects can get the
 * ones it missed. A run is kept until `keepMs` after it ends; after that, or
 * a restart, it's unknown.
 */
export function createRunStore<E>({
  log,
  keepMs = 5 * 60_000,
}: {
  log: Logger;
  keepMs?: number;
}): RunStore<E> {
  const runs = new Map<
    string,
    { events: E[]; ended: boolean; listeners: Set<RunListener<E>> }
  >();

  // A listener that throws, like a stream whose visitor left, can't stop the run.
  const tell = (call: () => void) => {
    try {
      call();
    } catch (err) {
      log.error({ err }, "a run's listener failed");
    }
  };

  return {
    start: (id) => {
      runs.set(id, { events: [], ended: false, listeners: new Set() });
    },
    add: (id, event) => {
      const run = runs.get(id);
      if (!run || run.ended) return;
      run.events.push(event);
      const number = run.events.length;
      for (const listener of run.listeners) {
        tell(() => {
          listener.event(number, event);
        });
      }
    },
    end: (id) => {
      const run = runs.get(id);
      if (!run || run.ended) return;
      run.ended = true;
      for (const listener of run.listeners) {
        tell(() => {
          listener.end();
        });
      }
      run.listeners.clear();
      // Unref'd, so a run kept in memory never holds the process open.
      setTimeout(() => runs.delete(id), keepMs).unref();
    },
    get: (id) => runs.get(id),
    listen: (id, listener) => {
      const run = runs.get(id);
      if (!run || run.ended) return () => undefined;
      run.listeners.add(listener);
      return () => {
        run.listeners.delete(listener);
      };
    },
  };
}
