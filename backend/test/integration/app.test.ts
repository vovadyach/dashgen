import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ErrorBody } from "@dashgen/contracts";

import { QUESTION } from "../fixtures/agent.ts";
import { VALID_ENV } from "../fixtures/config.ts";
import { startApp } from "../helpers/app.ts";
import { assertRecentUuidV7 } from "../helpers/uuid.ts";

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
    it("answers 501 until the agent exists", async (t) => {
      const app = await startApp(t);

      const response = await app.inject({
        method: "POST",
        url: "/ask",
        payload: { question: QUESTION },
      });

      assert.equal(response.statusCode, 501);
      assert.deepEqual(response.json(), {
        error: { code: "not_implemented", message: "Not implemented yet." },
      });
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
      assert.equal(longest.statusCode, 501);
    });

    it("is rate limited per client IP", async (t) => {
      const app = await startApp(t);
      const ask = (remoteAddress: string) =>
        app.inject({
          method: "POST",
          url: "/ask",
          payload: { question: QUESTION },
          remoteAddress,
        });

      for (let i = 0; i < 10; i++) {
        assert.equal((await ask("203.0.113.1")).statusCode, 501);
      }
      const limited = await ask("203.0.113.1");

      assert.equal(limited.statusCode, 429);
      assert.equal(limited.json<ErrorBody>().error.code, "rate_limited");
      assert.ok(Number(limited.headers["retry-after"]) >= 1);
      assert.equal((await ask("203.0.113.2")).statusCode, 501);
    });
  });

  describe("CORS", () => {
    it("allows the configured origin", async (t) => {
      const app = await startApp(t);
      const origin = VALID_ENV.ALLOWED_ORIGINS;

      const response = await app.inject({
        method: "OPTIONS",
        url: "/ask",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });

      assert.equal(response.statusCode, 204);
      assert.equal(response.headers["access-control-allow-origin"], origin);
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

    it("describes /ask in the OpenAPI document", async (t) => {
      const app = await startApp(t);

      const response = await app.inject({
        method: "GET",
        url: "/docs/openapi.json",
      });

      assert.equal(response.statusCode, 200);
      const spec = response.json<{ paths: Record<string, unknown> }>();
      assert.ok("/ask" in spec.paths);
    });
  });
});
