# 11. REST and SSE between the React app and the backend

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

[ADR-0007](0007-trpc.md) chose tRPC for the page's calls. The API turned out to be two calls: one starts a run, and one streams its events. Both options handle that, so the choice comes down to cost.

The options considered:

- **Keep tRPC.** Calls are typed from the backend's router, with no client to write, and a dropped stream reconnects and replays by itself. But the OpenAPI docs at `/docs` go (`@trpc/openapi` is alpha and skips subscriptions), batching moves the per-IP limit into middleware, our error codes need a formatter, and three packages are added.
- **REST and SSE.** The backend already serves REST with Zod: `POST /ask` has its validation, rate limit, error shape and tests. The browser's `EventSource` reconnects by itself and sends the last event's ID, so replay is a check on the server.

## Decision

REST and SSE, replacing ADR-0007.

- **`POST /ask`** starts a run and answers `202` with its `runId`.
- **`GET /runs/:id/events`** streams the run's events as SSE: a `step` per tool call, then how the run ended. Each event has an ID, and a reconnect gets only the events after its `Last-Event-ID`.
- The two stay separate, as in ADR-0007, so a reconnect never starts, or pays for, a second run.
- The schemas live in `@dashgen/contracts`, shared by the page and the backend.

## Consequences

- The OpenAPI docs keep every route, and the backend gets no new package.
- The page needs a small client of its own: `fetch` for `POST /ask`, and an `EventSource` for the stream. A renamed route fails when the page runs, not when it builds, unless the shared schemas catch it.
- CloudFront must forward the `Last-Event-ID` header, or a reconnect gets every event again from the first.
