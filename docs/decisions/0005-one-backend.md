# 5. One TypeScript backend, with modules inside

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

DashGen had two backend services: a gateway that runs the agent, and a Go metrics service that owns the time series, each with its own database in one Postgres instance. The split was easiest to justify while the two were in different languages. With the metrics service moving to TypeScript too, it was worth asking whether the split still paid for itself.

The estimates say it doesn't. There are about 7,200 metric rows and 2–3 questions in flight at a busy moment, mostly waiting on Gemini ([estimates](../design.md#2-estimates)). Nothing needs to scale or deploy on its own, and one person builds everything.

The options considered:

- **Two services,** as designed. They show service-to-service calls with timeouts and retries, and a network boundary around the data. They cost an internal HTTP hop, a second deploy and image, service discovery on AWS, and two database setups.
- **One backend with modules inside.** One process, one deploy and one database, with the agent calling the metrics code as functions.

The network boundary's safety argument turned out weaker than it looked. The model can only call fixed tools with checked arguments, never SQL, and the data is sample data.

## Decision

One TypeScript backend: a Fastify service, renamed from `gateway` to `backend`, holding the modules `api`, `agent`, `metrics`, `runs` and `cap`, with one Postgres database.

- Modules talk only through each other's `index.ts`. The agent's tools call `metrics.listServices()` and `metrics.query(...)`, which are read-only.
- The Go metrics service is removed. Its tables, seed and queries move into the `metrics` module.

## Consequences

- One container, one deploy and one ECS service on AWS: no Service Connect and one fewer Fargate task.
- One migration workflow for every table.
- No network hop between the agent and the data, so no timeouts or retries there.
- The agent and the metrics code deploy and restart together. That's fine without an uptime promise.
- **When to split:** if the metrics need consumers other than the agent, their own scaling, or isolation, the `metrics` module becomes a service. Its `index.ts` is already the API it would offer.
