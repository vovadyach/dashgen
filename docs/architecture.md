# Architecture

What runs today, and its API. [design.md](design.md) has the target design, the [roadmap](roadmap.md) what comes next, and the [decisions](decisions/) why.

## The pieces

```
Browser ──▶ Backend ──▶ Postgres
           (Fastify)    (one empty database, for now)
```

- **Backend** (`backend/`): one TypeScript service. Today it takes questions and answers 501, because the agent arrives in step 3.
- **Postgres** runs in Docker Compose (`make db`), with one `dashgen` database and user. Step 2 adds the tables and the sample data.
- **Frontend:** planned for step 3.

How a question will become a chart is drawn in [design.md](design.md#one-question-step-by-step).

## Backend API

`http://localhost:3000`. Interactive docs, generated from the routes' Zod schemas, are at `/docs`, and the OpenAPI document at `/docs/openapi.json`.

**`GET /health`** returns `200 {"status":"ok"}`.

**`POST /ask`** takes `{"question": "..."}`, at least one character long.

| Status | Code | When |
|---|---|---|
| 501 | `not_implemented` | the question is valid, until the agent arrives |
| 422 | `invalid_question` | `question` is missing or empty |
| 429 | `rate_limited` | an IP's 11th request in a minute, counted from its first, with `Retry-After` |
| 400 | `bad_request` | the body isn't valid JSON, or Fastify rejects the request |
| 404 | `not_found` | an unknown route |
| 500 | `internal_error` | an unexpected failure |

Every error is `{"error": {"code": "...", "message": "..."}}`, and the message is safe to show visitors. The [target design](design.md#the-frontends-api) keeps these codes, sent through tRPC. CORS allows only the origins in `ALLOWED_ORIGINS`, and only `GET` and `POST`.

## Configuration

| Where | Settings |
|---|---|
| `backend/.env` (from `backend/.env.example`), read by `npm run dev` | `GEMINI_API_KEY`, `ALLOWED_ORIGINS`. A missing or invalid one stops the backend at startup |
| `.env` at the root (from `.env.example`), read by Docker Compose | `POSTGRES_PASSWORD`, `DASHGEN_DB_PASSWORD` |

## Known limits

- **The rate limit is per process,** in memory, so a restart resets it. Step 4's [daily cap](design.md#the-daily-cap) is shared.
- **Behind a load balancer,** every request would come from its IP. Step 5 takes the visitor's IP from CloudFront instead ([ADR-0003](decisions/0003-cloudfront-front-door.md)).
- **There's no sample data yet.** The Go service that served 7 hardcoded days is gone, and step 2's Drizzle work brings 30 days of hourly data in Postgres.
