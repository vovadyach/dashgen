# Architecture

What runs today, and its API. [design.md](design.md) has the target design, the [roadmap](roadmap.md) what comes next, and the [decisions](decisions/) why.

## The pieces

```
Browser ──▶ Frontend ──── /api ──▶ Backend ──────────────▶ Postgres
           (React page,            (Fastify)                (dashgen database: services, metrics, points, runs)
            Vite on :5173)           ├── agent ───────────▶ Gemini or Claude (AI_MODEL)
                                     ├── metrics module ──▶ read-only queries
                                     ├── runs module ─────▶ one row per finished run
                                     └── cap module ──────▶ DynamoDB Local (today's count of questions)
```

- **Frontend** (`frontend/`): the React page. It has a question box with example questions to click, and a note under it that questions are saved, with a link to Cloudflare's Turnstile Privacy Addendum, the agent's steps as they stream in, and the chart, which AG Charts draws ([ADR-0012](decisions/0012-shadcn-and-ag-charts.md)), with a data table under it. Stop, or Esc, stops watching a question; the run still finishes and is saved. A chart can be pinned to the watchlist, saved in the browser with its numbers; copied as a link that carries the chart ([ADR-0013](decisions/0013-share-links-carry-the-chart.md)); or downloaded as a PNG. Pins and links open with no call to the backend. Each question carries a token from Cloudflare Turnstile's invisible widget, which shows a person asks ([ADR-0021](decisions/0021-turnstile-bot-check.md)). As it opens, while its code downloads, the page gives `GET /api/health` 3 seconds: anything but a 200 with `{"status": "ok"}` shows a banner that the live demo is offline, and turns off everything that sends a question, as does a question that gets CloudFront's offline 503. While offline, the page checks again each time its tab comes back into view ([ADR-0003](decisions/0003-cloudfront-front-door.md)). It works on phones from 320 px wide: there the answer comes before the steps and the examples make way for it, bars that compare services lie across, and a chart's legend gets a line per service. Until the page's code arrives, `index.html` shows a loader, a pinned card's mini chart drawing a line, then bars, then a pie, or says the code couldn't load, with the page's CSS inline ([ADR-0020](decisions/0020-first-paint-in-index-html.md)). Locally, Vite's dev server forwards `/api` to the backend, the paths CloudFront will forward on AWS.
- **Backend** (`backend/`): one TypeScript service. Its HTTP API takes a question, runs the agent in the background, and streams the run's events.
- **The `metrics` module** (`backend/src/metrics/`): `listServices()` and `query()` over the seeded data. The agent's tools call it.
- **The `agent` module** (`backend/src/agent/`): the [five tools](design.md#the-agents-tools), an adapter for each provider, Gemini and Claude, of which `AI_MODEL` picks one ([ADR-0016](decisions/0016-ai-model-setting.md)), and `runAgent`, the loop that answers a question with them within [its limits](design.md#the-daily-cap) ([ADR-0010](decisions/0010-agent-loop.md)). `POST /api/ask` runs it for each question. `npm run model:check` tries the chosen model with two real requests.
- **The `runs` module** (`backend/src/runs/`): each run's events in memory, for its stream, and `saveRun()`, which keeps each finished run in the `runs` table, with its cost.
- **The `cap` module** (`backend/src/cap/`): the [daily cap](design.md#the-daily-cap). `POST /api/ask` takes one of today's 150 questions with one conditional write to DynamoDB before it starts a run ([ADR-0014](decisions/0014-daily-cap-in-dynamodb.md)).
- **The `bots` module** (`backend/src/bots/`): Cloudflare Turnstile's check that a person asks. `POST /api/ask` sends each question's token to Cloudflare's `siteverify` before the daily cap, so a bot takes none of today's questions. Without `TURNSTILE_SECRET_KEY`, as locally, there's no check ([ADR-0021](decisions/0021-turnstile-bot-check.md)).
- **The `mcp` module** (`backend/src/mcp/`): DashGen's tools for MCP clients, like Claude Code, taken from the agent's own, so their names, schemas and checks stay one set. The client's model calls them, so DashGen calls no model ([ADR-0022](decisions/0022-mcp-server.md)). `npm run mcp` serves them over stdio, against the local Postgres. So far it has `list_services` and `query_metrics`. Unlike a question to DashGen's own agent, a session has no limit on queries, and keeps its newest 20 results for charts.
- **Postgres** runs in Docker Compose (`make db`), with one `dashgen` database and user. The tables come from Drizzle migrations, and the data from the seed.
- **The backend's image** (`backend/Dockerfile`): Node 26 on Alpine, with only the production packages, run by the unprivileged `node` user. `.dockerignore` lists all it may take from the repo, so no `.env` file can reach it. `docker compose up` builds it, runs the migrations and the seed in a one-off `migrate` container, then starts the backend on :3000, as ECS will in step 5.
- **DynamoDB Local** runs in Docker Compose too (`make db`, port 8000), in memory, so a restart starts the count over. The backend makes its table when it starts. Its client uses fake keys, so it can't reach a real AWS account.

How a question will become a chart is drawn in [design.md](design.md#one-question-step-by-step).

## Backend API

`http://localhost:3000`, with every route under `/api`, the paths CloudFront will forward to the backend ([ADR-0003](decisions/0003-cloudfront-front-door.md)). Interactive docs, generated from the routes' Zod schemas, are at `/docs`, and the OpenAPI document at `/docs/openapi.json`.

Every response carries an `x-request-id` header: a UUIDv7, which also appears in that request's log lines ([ADR-0009](decisions/0009-uuidv7-ids.md)). The exceptions are the few sent before a request is routed: 400 or 431 for a malformed or oversized header, and 503 while the server shuts down.

**`GET /api/health`** returns `200 {"status":"ok"}`. It logs only warnings and errors, since load balancers call it all day.

**`POST /api/ask`** takes `{"question": "...", "turnstileToken": "..."}`: a question of 1 to 300 characters after trimming, with no NUL character, and the token of Cloudflare Turnstile's widget, up to 2,048 characters. It starts a run in the background and answers `202 {"runId": "..."}`, a UUIDv7.

| Status | Code | When |
|---|---|---|
| 422 | `invalid_question` | `question` is missing, blank, over 300 characters, or has a NUL character |
| 429 | `rate_limited` | an IP's 11th request in a minute, counted from its first, with `Retry-After` |
| 403 | `bot_check_failed` | the token is missing, or Cloudflare turns it down, whatever the HTTP status of its verdict. It takes none of today's questions. When Cloudflare is down (no answer within 3 seconds, a 5xx or a 429, or its own `internal-error`), the question goes through |
| 503 | `daily_cap` | today's 150 questions are used up, with `Retry-After`: the seconds until midnight UTC |
| 503 | `unavailable` | DynamoDB can't count the question, or the bot check's setup is wrong, as with a mistyped secret key, which logs `bot check misconfigured`. No run starts |
| 400 | `bad_request` | the body isn't valid JSON, or Fastify rejects the request |
| 404 | `not_found` | an unknown route |
| 500 | `internal_error` | an unexpected failure |

**`GET /api/runs/:id/events`** streams a run's events as SSE: a `step` per tool call, then an `outcome` or an `error`, each with an `id` counting from 1. It starts with a comment line, `: open`, so the headers go out at once. The stream ends after the last event and closes its connection. A reconnect that sends `Last-Event-ID` gets only the events after it. The events' schema is `RunEvent` in `@dashgen/contracts`, and [design.md](design.md#the-frontends-api) has examples and the error codes.

| Status | Code | When |
|---|---|---|
| 200 | | the stream |
| 204 | | every event was sent already, which tells `EventSource` to stop reconnecting |
| 404 | `run_not_found` | the run is unknown, or ended more than 5 minutes ago |

Every error is `{"error": {"code": "...", "message": "..."}}`, and the message is safe to show visitors. The codes are `ApiErrorCode` in `@dashgen/contracts`. The [target design](design.md#the-frontends-api) keeps these codes. CORS allows only the origins in `ALLOWED_ORIGINS`, and only `GET` and `POST`.

## Data

The tables are in [design.md](design.md#the-metrics-tables), and the module's results in [design.md](design.md#the-metrics-module).

| Command | Does |
|---|---|
| `npm run db:migrate` | Applies the SQL migrations in `backend/drizzle/` that haven't run yet |
| `npm run db:seed` | Replaces the sample data with 30 days of hourly points ending this hour, in one transaction |
| `npm run cost` | Prints each UTC day's questions from the `runs` table, what they cost, and the cost per question ([runbook](runbooks/costs.md)) |
| `npm run db:generate --workspace backend -- --name <change>` | After a schema change: writes the next SQL migration, to commit with it. Never `npx drizzle-kit`, which reads `backend/.env` |

Database tests run against a separate throwaway Postgres on port 5433, and DynamoDB Local on 8001 (`compose.test.yaml`), which `make check` starts. Each test file creates its own database or table there and drops it afterwards. To use another Postgres, 18 or later since the migrations use its `uuidv7()`, set `TEST_DATABASE_URL` in the shell to its admin URL, and `TEST_DYNAMODB_ENDPOINT` for another DynamoDB Local.

## Configuration

| Where | Settings |
|---|---|
| `backend/.env` (from `backend/.env.example`), read by `npm run dev`, `db:migrate`, `db:seed`, `model:check` and `eval` | `AI_MODEL` (`gemini-3.1-flash-lite`, the default, `gemini-3.5-flash-lite` or `claude-haiku-5-5`: the models DashGen has an adapter and prices for), `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` (only the one the model needs), `ALLOWED_ORIGINS`, `DATABASE_URL`, `DYNAMODB_ENDPOINT` (`http://localhost:8000`, the default), `DAILY_CAP` (150 questions a day by default), `HOST` and `PORT` (`localhost` and `3000` by default; the image sets `HOST=0.0.0.0`), `LOG_LEVEL` (`info` by default; `debug` adds every SQL statement). A missing or invalid one stops the command that needs it |
| `.env` at the root (from `.env.example`), read by Docker Compose | `POSTGRES_PASSWORD`, `DASHGEN_DB_PASSWORD` |

## Known limits

- **Run events live in memory,** so a restart loses them, and their streams answer 404 `run_not_found`. The runs themselves are saved in the `runs` table: closing the backend waits for the ones in progress.
- **The rate limit is per process,** in memory, so a restart resets it. The [daily cap](design.md#the-daily-cap) is shared.
- **Locally, the daily cap counts in DynamoDB Local,** which keeps its data in memory. On AWS, the backend counts in the always-on stack's table instead, with its task's role, since its task definition sets `DYNAMODB_REGION`.
- **The page is on AWS, and during a work session, so is the backend.** CloudFront serves the build from S3, which GitHub Actions uploads after each merge to `main` ([runbook](runbooks/deploy.md#the-page)). During a session, CloudFront sends `/api/*` to the backend on ECS, behind a load balancer that accepts only CloudFront, with Postgres on RDS, which a one-off task fills. `make aws-up` opens that door once the backend is healthy, and `make aws-down` closes it first ([runbook](runbooks/deploy.md#the-session-stack)). Between sessions, CloudFront answers every `/api/*` request with `503 {"status": "offline"}` itself ([runbook](runbooks/deploy.md#the-apis-door)), and the page shows its offline banner, with its question box off.
- **Behind the load balancer,** every request comes from its IP, so on AWS the rate limit counts by the visitor's IP that CloudFront's function sends as `x-viewer-ip`, which the task definition's `VIEWER_IP_HEADER` names. Locally, it counts by the connection's address ([ADR-0003](decisions/0003-cloudfront-front-door.md)).
- **Incidents in the seed move with the day it runs,** so "this week" always has one to find. The rest of an hour's value is the same whichever day the seed runs.
