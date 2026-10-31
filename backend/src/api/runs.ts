import { randomUUIDv7 } from "node:crypto";
import { PassThrough } from "node:stream";

import {
  AskRequest,
  AskResponse,
  ErrorBody,
  type RunEvent,
} from "@dashgen/contracts";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  type RunOptions,
  type RunResult,
  runAgent,
  type Usage,
} from "../agent/index.ts";
import type { Price } from "../config.ts";
import { withoutQueryValues } from "../db.ts";
import { ApiError, INTERNAL_ERROR } from "../errors.ts";
import type { Logger } from "../logger.ts";
import type { NewRun, RunStore } from "../runs/index.ts";
import { RunParams, StreamedEvent } from "./types.ts";

/** What runs need: Gemini and the database on the server, fakes in tests. */
export interface RunDeps extends Pick<RunOptions, "model" | "metrics"> {
  /** Saves a finished run to the runs table. */
  save: (run: NewRun) => Promise<void>;
}

export interface RunRoutesOptions extends RunDeps {
  store: RunStore<RunEvent>;
  /** The model's price, for each run's cost. */
  price: Price;
}

/** `POST /ask` starts a run, and `GET /runs/:id/events` streams its events (ADR-0011). */
export const runRoutes: FastifyPluginCallbackZod<RunRoutesOptions> = (
  app,
  { store, price, model, metrics, save },
  done,
) => {
  // Runs still going. Closing the app waits for them, so each is saved before
  // the database closes: Fastify runs this plugin's onClose before the app's.
  const running = new Set<Promise<void>>();
  app.addHook("onClose", async () => {
    await Promise.all(running);
  });

  /** Runs the agent in the background: its events go to the store, and the result to the runs table. */
  async function run(id: string, question: string, log: Logger) {
    let result: RunResult;
    try {
      result = await runAgent(question, {
        model,
        metrics,
        log,
        onEvent: (event) => {
          store.add(id, event);
        },
      });
    } catch (err) {
      // runAgent ends a run that hits a bug with internal_error itself. This is
      // for one that fails before its loop starts: the stream still ends, but
      // there's nothing to save.
      log.error({ err }, "run crashed");
      store.add(id, { type: "error", ...INTERNAL_ERROR });
      store.end(id);
      return;
    }
    store.end(id);
    try {
      await save(toRow(id, question, result, price));
    } catch (err) {
      log.error({ err: withoutQueryValues(err) }, "run not saved");
    }
  }

  app.post(
    "/ask",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        summary: "Starts a run that answers the question",
        body: AskRequest,
        response: { 202: AskResponse, 422: ErrorBody, 429: ErrorBody },
      },
    },
    (request, reply) => {
      const runId = randomUUIDv7();
      store.start(runId);
      const going = run(
        runId,
        request.body.question,
        request.log.child({ runId }),
      ).finally(() => {
        running.delete(going);
      });
      running.add(going);
      reply.code(202);
      return { runId };
    },
  );

  app.get(
    "/runs/:id/events",
    {
      schema: {
        summary: "Streams a run's events as SSE",
        description:
          "A step per tool call, then the outcome or an error, each with an ID. A reconnect gets only the events after its Last-Event-ID.",
        params: RunParams,
        response: {
          200: {
            description:
              "The stream. Each event's data is one of these, as JSON.",
            content: { "text/event-stream": { schema: StreamedEvent } },
          },
          // A null schema is how @fastify/swagger shows a response without a body.
          204: z
            .null()
            .describe(
              "Every event was sent already, which tells EventSource to stop reconnecting.",
            ),
          404: ErrorBody.describe(
            "run_not_found: the run is unknown, or ended more than 5 minutes ago.",
          ),
        },
      },
    },
    (request, reply) => {
      const { id } = request.params;
      const live = store.get(id);
      if (!live) {
        throw new ApiError(
          404,
          "run_not_found",
          "That answer is no longer available. Ask the question again.",
        );
      }
      const after = lastEventId(
        request.headers["last-event-id"],
        live.events.length,
      );
      // Every event was sent, and no more will come: 204 tells EventSource to stop reconnecting.
      if (live.ended && after === live.events.length) {
        return reply.code(204).send(null);
      }

      const stream = new PassThrough();
      // A comment line, which EventSource ignores, so the headers go out now,
      // not with the first event, which can take seconds.
      stream.write(": open\n\n");
      const send = (n: number, event: RunEvent) => {
        stream.write(`id: ${String(n)}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      live.events.slice(after).forEach((event, i) => {
        send(after + i + 1, event);
      });
      if (live.ended) {
        stream.end();
      } else {
        const stop = store.listen(id, { event: send, end: () => stream.end() });
        // The visitor left, so nobody reads the stream any more.
        reply.raw.on("close", stop);
      }
      return (
        reply
          .header("content-type", "text/event-stream")
          .header("cache-control", "no-store")
          // Closes the connection when the stream ends. Kept open, it would be
          // idle, and app.close() would wait for it to time out, over a minute.
          .header("connection", "close")
          .send(stream)
      );
    },
  );

  done();
};

/** How many events a reconnecting stream already has: 0 if its Last-Event-ID is missing or isn't one of the run's. */
function lastEventId(
  header: string | string[] | undefined,
  count: number,
): number {
  const id = Number(header);
  return Number.isInteger(id) && id >= 0 && id <= count ? id : 0;
}

/** A finished run as the runs table keeps it. */
function toRow(
  id: string,
  question: string,
  { end, steps, model, usage, ms }: RunResult,
  price: Price,
): NewRun {
  return {
    id,
    question,
    outcome: end.type === "outcome" ? end.outcome : "error",
    errorCode: end.type === "error" ? end.code : null,
    chart: end.type === "outcome" && end.outcome === "chart" ? end.chart : null,
    steps,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: costOf(usage, price),
    latencyMs: ms,
  };
}

/** In dollars, to the millionth that cost_usd keeps. */
const costOf = (usage: Usage, price: Price) =>
  (
    (usage.inputTokens * price.input + usage.outputTokens * price.output) /
    1_000_000
  ).toFixed(6);
