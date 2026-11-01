# Architecture

What runs today, and its API. [design.md](design.md) has the target design, the [roadmap](roadmap.md) what comes next, and the [decisions](decisions/) why.

## The pieces

```
Browser ──▶ Frontend ──── /api ──▶ Backend ──────────────▶ Postgres
           (React page,            (Fastify)                (dashgen database: services, metrics, points, runs)
            Vite on :5173)           ├── agent ───────────▶ Gemini
                                     ├── metrics module ──▶ read-only queries
                                     └── runs module ─────▶ one row per finished run
```

- **Frontend** (`frontend/`): the React page. It has a question box, the agent's steps as they stream in, and the chart, which AG Charts draws ([ADR-0012](decisions/0012-shadcn-and-ag-charts.md)), with a data table under it. Locally, Vite's dev server forwards `/api` to the backend, the paths CloudFront will forward on AWS.
- **Backend** (`backend/`): one TypeScript service. Its HTTP API takes a question, runs the agent in the background, and streams the run's events.
- **The `metrics` module** (`backend/src/metrics/`): `listServices()` and `query()` over the seeded data. The agent's tools call it.
- **The `agent` module** (`backend/src/agent/`): the [five tools](design.md#the-agents-tools), the Gemini adapter, and `runAgent`, the loop that answers a question with them within [its limits](design.md#the-daily-cap) ([ADR-0010](decisions/0010-agent-loop.md)). `POST /ask` runs it for each question. `npm run gemini:check` tries the adapter with two real requests.
- **The `runs` module** (`backend/src/runs/`): each run's events in memory, for its stream, and `saveRun()`, which keeps each finished run in the `runs` table, with its cost.
- **Postgres** runs in Docker Compose (`make db`), with one `dashgen` database and user. The tables come from Drizzle migrations, and the data from the seed.

How a question will become a chart is drawn in [design.md](design.md#one-question-step-by-step).

## Backend API

`http://localhost:3000`, with every route under `/api`, the paths CloudFront will forward to the backend ([ADR-0003](decisions/0003-cloudfront-front-door.md)). Interactive docs, generated from the routes' Zod schemas, are at `/docs`, and the OpenAPI document at `/docs/openapi.json`.

Every response carries an `x-request-id` header: a UUIDv7, which also appears in that request's log lines ([ADR-0009](decisions/0009-uuidv7-ids.md)). The exceptions are the few sent before a request is routed: 400 or 431 for a malformed or oversized header, and 503 while the server shuts down.

**`GET /api/health`** returns `200 {"status":"ok"}`.

**`POST /api/ask`** takes `{"question": "..."}`, 1 to 300 characters after trimming, with no NUL character. It starts a run in the background and answers `202 {"runId": "..."}`, a UUIDv7.

| Status | Code | When |
|---|---|---|
| 422 | `invalid_question` | `question` is missing, blank, over 300 characters, or has a NUL character |
| 429 | `rate_limited` | an IP's 11th request in a minute, counted from its first, with `Retry-After` |
| 400 | `bad_request` | the body isn't valid JSON, or Fastify rejects the request |
| 404 | `not_found` | an unknown route |
| 500 | `internal_error` | an unexpected failure |

**`GET /api/runs/:id/events`** streams a run's events as SSE: a `step` per tool call, then an `outcome` or an `error`, each with an `id` counting from 1. It starts with a comment line, `: open`, so the headers go out at once. The stream ends after the last event and closes its connection. A reconnect that sends `Last-Event-ID` gets only the events after it. The events' schema is `RunEvent` in `@dashgen/contracts`, and [design.md](design.md#the-frontends-api) has examples and the error codes.

| Status | Code | When |
|---|---|---|
| 200 | | the stream |
| 204 | | every event was sent already, which tells `EventSource` to stop reconnecting |
| 404 | `run_not_found` | the run is unknown, or ended more than 5 minutes ago |

Every error is `{"error": {"code": "...", "message": "..."}}`, and the message is safe to show visitors. The [target design](design.md#the-frontends-api) keeps these codes. CORS allows only the origins in `ALLOWED_ORIGINS`, and only `GET` and `POST`.

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
| `backend/.env` (from `backend/.env.example`), read by `npm run dev`, `db:migrate`, `db:seed` and `gemini:check` | `GEMINI_API_KEY`, `GEMINI_MODEL` (`gemini-3.1-flash-lite`, the default, or `gemini-3.5-flash-lite`: the models DashGen has prices for), `ALLOWED_ORIGINS`, `DATABASE_URL`, `LOG_LEVEL` (`info` by default; `debug` adds every SQL statement). A missing or invalid one stops the command that needs it |
| `.env` at the root (from `.env.example`), read by Docker Compose | `POSTGRES_PASSWORD`, `DASHGEN_DB_PASSWORD` |

## Known limits

- **Run events live in memory,** so a restart loses them, and their streams answer 404 `run_not_found`. The runs themselves are saved in the `runs` table: closing the backend waits for the ones in progress.
- **The rate limit is per process,** in memory, so a restart resets it. Step 4's [daily cap](design.md#the-daily-cap) is shared.
- **Behind a load balancer,** every request would come from its IP. Step 5 takes the visitor's IP from CloudFront instead ([ADR-0003](decisions/0003-cloudfront-front-door.md)).
- **Incidents in the seed move with the day it runs,** so "this week" always has one to find. The rest of an hour's value is the same whichever day the seed runs.
