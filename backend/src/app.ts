import { randomUUIDv7 } from "node:crypto";

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import Fastify, { type FastifyReply } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { Health, type RunEvent } from "@dashgen/contracts";

import { type RunDeps, runRoutes } from "./api/index.ts";
import type { Config } from "./config.ts";
import { withoutQueryValues } from "./db.ts";
import { ApiError, errorBody, INTERNAL_ERROR } from "./errors.ts";
import type { Logger } from "./logger.ts";
import { createRunStore } from "./runs/index.ts";

export interface AppOptions {
  /** JSON logs at `config.logLevel`, with an ID for each request. Off unless asked for, so tests stay quiet. */
  logger?: boolean;
  /**
   * Makes what runs need, with the app's logger: Gemini and the database on
   * the server, fakes in tests. `close` runs when the app closes.
   */
  runs: (log: Logger) => RunDeps & { close?: () => Promise<void> };
}

/** Builds the backend from `config`, so each test can pass its own. Nothing else reads the environment. */
export async function buildApp(config: Config, options: AppOptions) {
  const app = Fastify({
    logger: options.logger === true ? { level: config.logLevel } : false,
    // A UUIDv7 per request, to find its log lines. A run gets its own ID, since
    // it outlives the request that starts it (ADR-0009).
    genReqId: () => randomUUIDv7(),
    // Errors Fastify raises before routing, like a malformed URL, never reach
    // the error handler below, so they get the same shape here.
    frameworkErrors: (error, request, reply) => {
      // This reply belongs to no route, so its types allow no status or
      // body. Plain FastifyReply is what it is at runtime.
      const plain = reply as unknown as FastifyReply;
      void plain
        .header("x-request-id", request.id)
        .code(400)
        .send(errorBody("bad_request", error.message));
    },
  }).withTypeProvider<ZodTypeProvider>();

  // Route schemas are Zod schemas: they validate requests, type the handlers
  // and check responses, and @fastify/swagger turns them into the API docs.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply
        .code(error.statusCode)
        .send(errorBody(error.code, error.message));
    }
    // Only /ask has a request body to validate.
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply
        .code(422)
        .send(
          errorBody(
            "invalid_question",
            "The question must be 1 to 300 characters.",
          ),
        );
    }
    // Fastify's own client errors, like a body that isn't valid JSON.
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
    ) {
      return reply
        .code(error.statusCode)
        .send(errorBody("bad_request", error.message));
    }
    request.log.error({ err: withoutQueryValues(error) }, "unexpected error");
    return reply
      .code(500)
      .send(errorBody(INTERNAL_ERROR.code, INTERNAL_ERROR.message));
  });

  // The request ID goes back to the client too, so a report can point to its log lines.
  app.addHook("onRequest", (request, reply, done) => {
    void reply.header("x-request-id", request.id);
    done();
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(errorBody("not_found", "Not found.")),
  );

  await app.register(cors, {
    origin: config.allowedOrigins,
    methods: ["GET", "POST"],
    // EventSource sends Last-Event-ID when it reconnects to a run's stream.
    allowedHeaders: ["Content-Type", "Last-Event-ID"],
  });

  // Routes opt in with `config.rateLimit`. Counts are kept in memory, per
  // client IP: the address of whoever opened the connection.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new ApiError(
        429,
        "rate_limited",
        "Rate limit exceeded, try again later.",
      ),
  });

  await app.register(swagger, {
    openapi: {
      // 3.1 uses the JSON Schema that Zod writes, so a 204's null shows as no body.
      openapi: "3.1.0",
      info: { title: "DashGen backend", version: "0.1.0" },
    },
    transform: jsonSchemaTransform,
  });
  // Scalar draws the docs page from the OpenAPI document @fastify/swagger builds.
  await app.register(scalar, {
    routePrefix: "/docs",
    configuration: { metaData: { title: "DashGen API" } },
  });

  app.get("/health", { schema: { response: { 200: Health } } }, () => ({
    status: "ok" as const,
  }));

  const { close, ...runs } = options.runs(app.log);
  if (close) app.addHook("onClose", close);
  await app.register(runRoutes, {
    ...runs,
    store: createRunStore<RunEvent>({ log: app.log }),
    price: config.geminiPrice,
  });

  return app;
}
