import assert from "node:assert/strict";
import { randomUUIDv7 } from "node:crypto";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import type { AskResponse, ErrorBody } from "@dashgen/contracts";

import type { RunEvent } from "../../src/agent/types.ts";
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
    .filter((block) => block !== "")
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

    it("requires a question of 1 to 300 characters, after trimming", async (t) => {
      const app = await startApp(t);

      for (const payload of [
        {},
        { question: "" },
        { question: "   " },
        { question: "x".repeat(301) },
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
      const saved: NewRun[] = [];
      const app = await startApp(t, {
        model: exampleModel(),
        save: (run) => {
          saved.push(run);
          return Promise.resolve();
        },
      });

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
      let answer: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        answer = resolve;
      });
      const app = await startApp(t, {
        model: {
          name: "fake-model",
          next: async () => {
            await answered;
            return declineReply();
          },
        },
      });
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

    it("ends the stream with internal_error when a run crashes on a bug", async (t) => {
      const app = await startApp(t, { model: fakeModel([new Error("a bug")]) });

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
