import assert from "node:assert/strict";
import { test } from "node:test";

import type { ErrorBody } from "../src/errors.ts";
import { startApp, VALID_ENV } from "./helpers.ts";

const QUESTION = { question: "Show errors for payments-service this week" };

test("health answers ok", async (t) => {
  const app = await startApp(t);

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

test("ask answers 501 until the agent exists", async (t) => {
  const app = await startApp(t);

  const response = await app.inject({
    method: "POST",
    url: "/ask",
    payload: QUESTION,
  });

  assert.equal(response.statusCode, 501);
  assert.deepEqual(response.json(), {
    error: { code: "not_implemented", message: "Not implemented yet." },
  });
});

test("ask requires a question", async (t) => {
  const app = await startApp(t);

  for (const payload of [{}, { question: "" }]) {
    const response = await app.inject({ method: "POST", url: "/ask", payload });

    assert.equal(response.statusCode, 422);
    assert.equal(response.json<ErrorBody>().error.code, "invalid_question");
  }
});

test("ask is rate limited per client IP", async (t) => {
  const app = await startApp(t);
  const ask = (remoteAddress: string) =>
    app.inject({
      method: "POST",
      url: "/ask",
      payload: QUESTION,
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

test("health isn't rate limited", async (t) => {
  const app = await startApp(t);

  for (let i = 0; i < 15; i++) {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
  }
});

test("CORS allows the configured origin", async (t) => {
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

test("CORS rejects other origins", async (t) => {
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

test("unknown routes answer with the error shape", async (t) => {
  const app = await startApp(t);

  const response = await app.inject({ method: "GET", url: "/nope" });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json<ErrorBody>().error.code, "not_found");
});

test("the API docs describe /ask", async (t) => {
  const app = await startApp(t);

  const response = await app.inject({ method: "GET", url: "/docs/json" });

  assert.equal(response.statusCode, 200);
  const spec = response.json<{ paths: Record<string, unknown> }>();
  assert.ok("/ask" in spec.paths);
});
