import assert from "node:assert/strict";
import { randomUUIDv7 } from "node:crypto";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import type { AskResponse, ErrorBody, RunEvent } from "@dashgen/contracts";

import type { Model } from "../../src/agent/types.ts";
import type { NewRun } from "../../src/runs/index.ts";
import { CHART, QUERY, QUESTION } from "../fixtures/agent.ts";
import { VALID_ENV } from "../fixtures/config.ts";
import { startApp } from "../helpers/app.ts";
import { declineReply, fakeModel, reply } from "../helpers/model.ts";
import { assertRecentUuidV7 } from "../helpers/uuid.ts";

type App = Awaited<ReturnType<typeof startApp>>;

/** Asks QUESTION, and returns the run's ID. */
async function ask(app: App): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/ask",
    payload: { question: QUESTION },
  });
  assert.equal(response.statusCode, 202);
  return response.json<AskResponse>().runId;
}

/** Reads a run's stream to its end, with each event and its ID. */
async function readEvents(app: App, runId: string, lastEventId?: number) {
  const response = await app.inject({
    method: "GET",
    url: `/runs/${runId}/events`,
    headers:
      lastEventId === undefined ? {} : { "last-event-id": String(lastEventId) },
  });
  const events = response.body
    .split("\n\n")
    // A block that starts with a colon is a comment, not an event.
    .filter((block) => block !== "" && !block.startsWith(":"))
    .map((block) => {
      const field = (name: string) =>
        block
          .split("\n")
          .find((line) => line.startsWith(`${name}: `))
          ?.slice(name.length + 2) ?? "";
      return {
        id: Number(field("id")),
        event: JSON.parse(field("data")) as RunEvent,
      };
    });
  return { response, events };
}

/** The design's example: the services, a query, then a chart. */
const exampleModel = () =>
  fakeModel([
    reply(["list_services"]),
    reply(["query_metrics", QUERY]),
    reply(["create_chart", CHART]),
  ]);

/** A model that declines once `answer()` is called, so a test can act while the run is still going. */
function thinkingModel() {
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  const model: Model = {
    name: "fake-model",
    next: async () => {
      await answered;
      return declineReply();
    },
  };
  return { model, answer };
}

/** Saves into a list, so a test can check what was saved. */
function savedRuns() {
  const saved: NewRun[] = [];
  const save = (run: NewRun) => {
    saved.push(run);
    return Promise.resolve();
  };
  return { saved, save };
}

describe("HTTP API", () => {
  it("gives each response its own request ID, a UUIDv7 with the time in it", async (t) => {
    const app = await startApp(t);

    const ids = await Promise.all(
      [1, 2].map(async () => {
        const response = await app.inject({ method: "GET", url: "/health" });
        return response.headers["x-request-id"];
      }),
    );

    for (const id of ids) assertRecentUuidV7(id);
    assert.notEqual(ids[0], ids[1]);
  });

  describe("GET /health", () => {
    it("answers ok", async (t) => {
      const app = await startApp(t);

      const response = await app.inject({ method: "GET", url: "/health" });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { status: "ok" });
    });

    it("isn't rate limited", async (t) => {
      const app = await startApp(t);

      for (let i = 0; i < 15; i++) {
        const response = await app.inject({ method: "GET", url: "/health" });
        assert.equal(response.statusCode, 200);
      }
    });
  });

  describe("POST /ask", () => {
    it("starts a run and answers 202 with its ID, a UUIDv7", async (t) => {
      const app = await startApp(t);

      assertRecentUuidV7(await ask(app));
    });

    it("requires a question of 1 to 300 characters after trimming, with no NUL character", async (t) => {
      const app = await startApp(t);

      for (const payload of [
        {},
        { question: "" },
        { question: "   " },
        { question: "x".repeat(301) },
        // Postgres can't store it, so the run couldn't be saved.
        { question: "Show errors\u0000" },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/ask",
          payload,
        });

        assert.equal(response.statusCode, 422);
        assert.equal(response.json<ErrorBody>().error.code, "invalid_question");
      }

      // The longest allowed question, with spaces around it that trimming removes.
      const longest = await app.inject({
        method: "POST",
        url: "/ask",
        payload: { question: `  ${"x".repeat(300)}  ` },
      });
      assert.equal(longest.statusCode, 202);
    });

    it("is rate limited per client IP", async (t) => {
      const app = await startApp(t);
      const askFrom = (remoteAddress: string) =>
        app.inject({
          method: "POST",
          url: "/ask",
          payload: { question: QUESTION },
          remoteAddress,
        });

      for (let i = 0; i < 10; i++) {
        assert.equal((await askFrom("203.0.113.1")).statusCode, 202);
      }
      const limited = await askFrom("203.0.113.1");

      assert.equal(limited.statusCode, 429);
      assert.equal(limited.json<ErrorBody>().error.code, "rate_limited");
      assert.ok(Number(limited.headers["retry-after"]) >= 1);
      assert.equal((await askFrom("203.0.113.2")).statusCode, 202);
    });

    it("saves each finished run, with its cost", async (t) => {
      const { saved, save } = savedRuns();
      const app = await startApp(t, { model: exampleModel(), save });

      const runId = await ask(app);
      // The run is saved as soon as it ends, which also ends its stream.
      await readEvents(app, runId);

      const [run] = saved;
      assert.ok(run);
      assert.equal(run.id, runId);
      assert.equal(run.question, QUESTION);
      assert.equal(run.outcome, "chart");
      assert.equal(run.errorCode, null);
      assert.deepEqual([run.inputTokens, run.outputTokens], [6_000, 180]);
      // At $0.25 a million input tokens, and $1.50 a million output.
      assert.equal(run.costUsd, "0.001770");
    });
  });

  describe("GET /runs/:id/events", () => {
    it("streams the run's steps, then how it ended, numbered from 1", async (t) => {
      const app = await startApp(t, { model: exampleModel() });

      const { response, events } = await readEvents(app, await ask(app));

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["content-type"], "text/event-stream");
      assert.deepEqual(
        events.map(({ id, event }) => `${String(id)} ${event.type}`),
        ["1 step", "2 step", "3 step", "4 outcome"],
      );
    });

    it("sends events as they come to a stream opened before the run ends", async (t) => {
      const { model, answer } = thinkingModel();
      const app = await startApp(t, { model });
      const runId = await ask(app);

      const reading = readEvents(app, runId);
      // The stream is open while the model is still thinking.
      await sleep(20);
      answer();
      const { events } = await reading;

      // The decline call, then the outcome it ends the run with.
      assert.deepEqual(
        events.map(({ event }) => event.type),
        ["step", "outcome"],
      );
    });

    it("sends a reconnect only the events after its Last-Event-ID", async (t) => {
      const app = await startApp(t, { model: exampleModel() });
      const runId = await ask(app);
      await readEvents(app, runId);

      const { events } = await readEvents(app, runId, 2);

      assert.deepEqual(
        events.map(({ id }) => id),
        [3, 4],
      );
    });

    it("answers 204 once every event was sent, so EventSource stops reconnecting", async (t) => {
      const app = await startApp(t);
      const runId = await ask(app);
      const { events } = await readEvents(app, runId);

      const { response } = await readEvents(app, runId, events.length);

      assert.equal(response.statusCode, 204);
    });

    it("answers 404 run_not_found for a run it doesn't know", async (t) => {
      const app = await startApp(t);

      const response = await app.inject({
        method: "GET",
        url: `/runs/${randomUUIDv7()}/events`,
      });

      assert.equal(response.statusCode, 404);
      assert.equal(response.json<ErrorBody>().error.code, "run_not_found");
    });

    it("sends its headers at once, before the first event", async (t) => {
      const { model, answer } = thinkingModel();
      const app = await startApp(t, { model });
      // A real connection: inject() can't show when the headers arrive.
      const url = await app.listen({ host: "127.0.0.1", port: 0 });
      const runId = await ask(app);

      // fetch resolves when the headers arrive, while the model is still
      // thinking, or fails after 2 seconds. The model answers either way, so
      // the run ends and the app can close.
      const response = await fetch(`${url}/runs/${runId}/events`, {
        signal: AbortSignal.timeout(2_000),
      }).finally(() => {
        answer();
      });

      assert.equal(response.status, 200);
      assert.match(await response.text(), /"type":"outcome"/);
    });

    it("closes its connection when it ends, so closing the app never waits on it", async (t) => {
      const app = await startApp(t);

      const { response } = await readEvents(app, await ask(app));

      // Kept open, it would sit idle, and app.close() would wait over a
      // minute for it to time out.
      assert.equal(response.headers.connection, "close");
    });

    it("ends the stream with internal_error when a run hits a bug, and still saves it", async (t) => {
      const { saved, save } = savedRuns();
      const app = await startApp(t, {
        model: fakeModel([new Error("a bug")]),
        save,
      });

      const { events } = await readEvents(app, await ask(app));

      assert.deepEqual(
        events.map(({ event }) => event),
        [
          {
            type: "error",
            code: "internal_error",
            message: "Something went wrong.",
          },
        ],
      );
      assert.equal(saved[0]?.errorCode, "internal_error");
    });

    it("ends the stream with internal_error even when a run fails before its loop starts", async (t) => {
      const app = await startApp(t, {
        metrics: () => {
          throw new Error("a bug");
        },
      });

      const { events } = await readEvents(app, await ask(app));

      assert.deepEqual(
        events.map(({ event }) => event.type === "error" && event.code),
        ["internal_error"],
      );
    });
  });

  describe("closing", () => {
    it("waits for runs still going, so each is saved before the database closes", async (t) => {
      const { model, answer } = thinkingModel();
      const order: string[] = [];
      const app = await startApp(t, {
        model,
        save: () => {
          order.push("run saved");
          return Promise.resolve();
        },
        close: () => {
          order.push("database closed");
          return Promise.resolve();
        },
      });
      await ask(app);

      const closed = app.close();
      // Time enough for the database to close first, if closing didn't wait.
      await sleep(20);
      answer();
      await closed;

      assert.deepEqual(order, ["run saved", "database closed"]);
    });
  });

  describe("CORS", () => {
    it("allows the configured origin, and the header a stream reconnects with", async (t) => {
      const app = await startApp(t);
      const origin = VALID_ENV.ALLOWED_ORIGINS;

      const response = await app.inject({
        method: "OPTIONS",
        url: "/ask",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type, last-event-id",
        },
      });

      assert.equal(response.statusCode, 204);
      assert.equal(response.headers["access-control-allow-origin"], origin);
      assert.match(
        String(response.headers["access-control-allow-headers"]),
        /Last-Event-ID/,
      );
    });

    it("rejects other origins", async (t) => {
      const app = await startApp(t);

      const response = await app.inject({
        method: "OPTIONS",
        url: "/ask",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "POST",
        },
      });

      assert.equal(response.headers["access-control-allow-origin"], undefined);
    });
  });

  describe("errors", () => {
    it("answers an unknown route with the error shape", async (t) => {
      const app = await startApp(t);

      const response = await app.inject({ method: "GET", url: "/nope" });

      assert.equal(response.statusCode, 404);
      assert.equal(response.json<ErrorBody>().error.code, "not_found");
    });

    it("answers a malformed URL with the error shape, and a request ID", async (t) => {
      const app = await startApp(t);

      const response = await app.inject({ method: "GET", url: "/%world" });

      assert.equal(response.statusCode, 400);
      assert.equal(response.json<ErrorBody>().error.code, "bad_request");
      assertRecentUuidV7(response.headers["x-request-id"]);
    });
  });

  describe("docs", () => {
    it("serves the docs page", async (t) => {
      const app = await startApp(t);

      const redirect = await app.inject({ method: "GET", url: "/docs" });
      const page = await app.inject({ method: "GET", url: "/docs/" });

      assert.equal(redirect.statusCode, 301);
      assert.equal(redirect.headers.location, "/docs/");
      assert.equal(page.statusCode, 200);
      assert.match(page.headers["content-type"] ?? "", /text\/html/);
    });

    it("describes both run routes in the OpenAPI document", async (t) => {
      const app = await startApp(t);

      const response = await app.inject({
        method: "GET",
        url: "/docs/openapi.json",
      });

      assert.equal(response.statusCode, 200);
      const spec = response.json<{ paths: Record<string, unknown> }>();
      assert.ok("/ask" in spec.paths);
      assert.ok("/runs/{id}/events" in spec.paths);
    });
  });
});
