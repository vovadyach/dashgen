# Architecture

What runs today, and its API. [design.md](design.md) has the target design, the [roadmap](roadmap.md) what comes next, and the [decisions](decisions/) why.

## The pieces

```
Browser ──▶ Backend ──────────────▶ Postgres
           (Fastify)                (dashgen database: services, metrics, points, runs)
             └── metrics module ──▶ read-only queries
```

- **Backend** (`backend/`): one TypeScript service. Its HTTP API takes questions and answers 501, because the agent arrives in step 3.
- **The `metrics` module** (`backend/src/metrics/`): `listServices()` and `query()` over the seeded data. Nothing calls it yet; the agent's tools will.
- **Postgres** runs in Docker Compose (`make db`), with one `dashgen` database and user. The tables come from Drizzle migrations, and the data from the seed.
- **Frontend:** planned for step 3.

How a question will become a chart is drawn in [design.md](design.md#one-question-step-by-step).

## Backend API

`http://localhost:3000`. Interactive docs, generated from the routes' Zod schemas, are at `/docs`, and the OpenAPI document at `/docs/openapi.json`.

Every response carries an `x-request-id` header: a UUIDv7, which also appears in that request's log lines ([ADR-0009](decisions/0009-uuidv7-ids.md)). The exceptions are the few sent before a request is routed: 400 or 431 for a malformed or oversized header, and 503 while the server shuts down.

**`GET /health`** returns `200 {"status":"ok"}`.

**`POST /ask`** takes `{"question": "..."}`, 1 to 300 characters after trimming.

| Status | Code | When |
|---|---|---|
| 501 | `not_implemented` | the question is valid, until the agent arrives |
| 422 | `invalid_question` | `question` is missing, blank or over 300 characters |
| 429 | `rate_limited` | an IP's 11th request in a minute, counted from its first, with `Retry-After` |
| 400 | `bad_request` | the body isn't valid JSON, or Fastify rejects the request |
| 404 | `not_found` | an unknown route |
| 500 | `internal_error` | an unexpected failure |

Every error is `{"error": {"code": "...", "message": "..."}}`, and the message is safe to show visitors. The [target design](design.md#the-frontends-api) keeps these codes, sent through tRPC. CORS allows only the origins in `ALLOWED_ORIGINS`, and only `GET` and `POST`.

## Data

The tables are in [design.md](design.md#the-metrics-tables), and the module's results in [design.md](design.md#the-metrics-module).

| Command | Does |
|---|---|
| `npm run db:migrate` | Applies the SQL migrations in `backend/drizzle/` that haven't run yet |
| `npm run db:seed` | Replaces the sample data with 30 days of hourly points ending this hour, in one transaction |
| `npm run db:generate --workspace backend -- --name <change>` | After a schema change: writes the next SQL migration, to commit with it. Never `npx drizzle-kit`, which reads `backend/.env` |

Database tests run against a separate throwaway Postgres on port 5433 (`compose.test.yaml`), which `make check` starts. Each test file creates its own database there and drops it afterwards. To use another Postgres, 18 or later since the migrations use its `uuidv7()`, set `TEST_DATABASE_URL` in the shell to its admin URL.

## Configuration

| Where | Settings |
|---|---|
| `backend/.env` (from `backend/.env.example`), read by `npm run dev`, `db:migrate`, `db:seed` and `gemini:check` | `GEMINI_API_KEY`, `GEMINI_MODEL` (`gemini-3.1-flash-lite` by default), `ALLOWED_ORIGINS`, `DATABASE_URL`, `LOG_LEVEL` (`info` by default; `debug` adds every SQL statement). A missing or invalid one stops the command that needs it |
| `.env` at the root (from `.env.example`), read by Docker Compose | `POSTGRES_PASSWORD`, `DASHGEN_DB_PASSWORD` |

## Known limits

- **The rate limit is per process,** in memory, so a restart resets it. Step 4's [daily cap](design.md#the-daily-cap) is shared.
- **Behind a load balancer,** every request would come from its IP. Step 5 takes the visitor's IP from CloudFront instead ([ADR-0003](decisions/0003-cloudfront-front-door.md)).
- **Incidents in the seed move with the day it runs,** so "this week" always has one to find. The rest of an hour's value is the same whichever day the seed runs.
