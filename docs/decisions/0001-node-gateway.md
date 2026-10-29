# 1. Node.js, Fastify and TypeScript for the gateway

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The gateway runs the LLM agent. It sends the visitor's question to Gemini, runs the tool calls the model asks for, and returns a chart to the frontend. It also holds the abuse controls: a rate limit per IP now, and a daily cap from step 4.

A Node.js + Express scaffold existed, with config loading, CORS, rate limiting and a `/chat` stub. There was no agent code yet, so the framework could still change cheaply. Three things shaped the choice:

- **Speed isn't the constraint.** Each question waits about 10 seconds on Gemini, at most 0.25 questions a second ([estimates](../design.md#traffic)), so any framework is fast enough.
- **Every input needs a schema that both validates it and types it.** Requests, and from step 4 the model's tool calls, arrive at runtime, and the frontend is TypeScript.
- **The SDKs exist.** Gemini (`@google/genai`) and MCP both have official TypeScript SDKs.

The options considered:

- **Express**, kept from the scaffold. The best known, but its types come from a separate community package, `req.body` is `any`, and validation, API docs and structured logs are all add-ons.
- **NestJS.** Modules and dependency injection: more framework than a service with two routes needs.
- **Fastify.** It ships its own types, validates and documents each route from its schema, logs JSON with an ID per request, and tests routes with `inject()` without opening a port. It's also faster, about 1.3–1.6 times Express's requests per second in its own benchmark, which doesn't matter at this traffic.

## Decision

The gateway is TypeScript on Node.js 24, with Fastify.

- **Zod for every schema:** settings, requests and responses now, and from step 4 the agent's tool arguments and charts. `fastify-type-provider-zod` types each handler from its route's schemas and checks the replies against them.
- **@fastify/swagger** builds an OpenAPI document from the same schemas, and **Scalar** draws it as the API docs at `/docs`. Swagger UI does the same job, but Scalar looks more current and has a request client built in. **@fastify/cors** and **@fastify/rate-limit** handle CORS and the per-IP limit.
- **Node's built-ins instead of more packages:** Node runs the `.ts` files directly by stripping the types, `node:test` runs the tests, `--watch` restarts on changes and `--env-file-if-exists` loads `.env`. TypeScript only checks types.
- **ESLint with typescript-eslint's type-aware rules, and Prettier.** TypeScript stays on 6.0, because typescript-eslint doesn't support 7 yet.
- **One error shape,** `{"error": {"code", "message"}}`, as [design.md](../design.md#the-frontends-api) plans for the public API.
- The Claude Code hooks are TypeScript too, checked with the gateway's tools.

## Consequences

- The frontend and the gateway share one language. Step 5 can import the gateway's Zod schemas instead of generating types, so an API change that breaks the page fails `tsc`.
- There's no build step: the code that runs is the code in the repo.
- Fastify's logger already gives step 3 its JSON logs with a request ID, and the server closes cleanly on SIGTERM, which ECS sends before stopping a task.
- Code can use only TypeScript that Node can strip: no enums or parameter properties. The `erasableSyntaxOnly` setting enforces it.
- Fewer eval libraries to lean on: step 6's evals are written with `node:test` and plain scripts.
- The rate limiter counts in fixed one-minute windows that start at a client's first request, so a client can get up to 20 questions through around the start of a new window. The daily cap, not this limit, protects the budget.
