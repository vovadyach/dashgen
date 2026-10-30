import { randomUUIDv7 } from "node:crypto";
import { PassThrough } from "node:stream";

import { AskRequest, AskResponse, ErrorBody } from "@dashgen/contracts";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { runAgent } from "../agent/run.ts";
import type { Model, RunEvent, RunResult, Usage } from "../agent/types.ts";
import type { Price } from "../config.ts";
import { withoutQueryValues } from "../db.ts";
import { ApiError } from "../errors.ts";
import type { Logger } from "../logger.ts";
import type { Metrics } from "../metrics/index.ts";
import type { NewRun } from "../runs/index.ts";
import type { RunStore } from "../runs/live.ts";

/** What runs need: Gemini and the database on the server, fakes in tests. */
export interface RunDeps {
  model: Model;
  /** A run's metrics module, with the run's fixed clock and its logger. */
  metrics: (now: () => Date, log: Logger) => Metrics;
  /** Saves a finished run to the runs table. */
  save: (run: NewRun) => Promise<void>;
}

export interface RunRoutesOptions extends RunDeps {
  store: RunStore<RunEvent>;
  /** The model's price, for each run's cost. */
  price: Price;
}

// A crashed run's last event, worded like the API's own 500.
const CRASHED: RunEvent = {
  type: "error",
  code: "internal_error",
  message: "Something went wrong.",
};

/** `POST /ask` starts a run, and `GET /runs/:id/events` streams its events (ADR-0011). */
export const runRoutes: FastifyPluginCallbackZod<RunRoutesOptions> = (
  app,
  { store, price, model, metrics, save },
  done,
) => {
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
      // A bug in DashGen. The stream still ends, with a message the page can
      // show, but the run isn't saved: its steps and tokens went with the error.
      log.error({ err }, "run crashed");
      store.add(id, CRASHED);
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
      void run(runId, request.body.question, request.log.child({ runId }));
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
          "A step per tool call, then the outcome or an error, each with an ID. A reconnect gets only the events after its Last-Event-ID. Answers 204 once every event was sent, and 404 run_not_found for an unknown or expired run.",
        params: z.object({ id: z.string() }),
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
        return reply.code(204).send();
      }

      const stream = new PassThrough();
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
      return reply
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-store")
        .send(stream);
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
