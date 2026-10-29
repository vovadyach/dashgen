# Architecture

What runs today: how DashGen's services fit together, and each one's API. [design.md](design.md) works out the target design and the reasons for it, the [roadmap](roadmap.md) says what comes next, and the [decisions](decisions/) record why.

## The pieces

```
Browser ──▶ Gateway ──▶ Metrics ──▶ Postgres
           (the agent)   (the data)
```

Today the metrics service and the gateway run, and Postgres runs in Docker Compose with an empty database per service. The frontend and the agent are still planned, and the README's [status table](../README.md#status) says in which step.

- **Metrics** owns the time series. Nothing else reads that data directly.
- **Gateway** owns the agent and, from step 2, the log of agent runs. It gets metrics only by calling the metrics service over HTTP.
- **Frontend** talks only to the gateway.

How a question will become a chart is drawn step by step in [design.md](design.md#one-question-step-by-step).

## Metrics API

`http://localhost:8080`. Responses are JSON and allow any origin (CORS `*`).

**`GET /health`** returns `200 {"status":"ok"}`.

**`GET /services`** returns `200` with the five services, in this order:

```json
{"services":["auth-service","payments-service","checkout-api","search-service","notifications-worker"]}
```

**`GET /metrics?service=&metric=&days=`**

| Parameter | Required | Values |
|---|---|---|
| `service` | yes | one of `/services` |
| `metric` | yes | `errors` (a daily count) or `latency_ms` (milliseconds) |
| `days` | no | a positive integer. Defaults to 7, and anything above 7 counts as 7 |

`GET /metrics?service=payments-service&metric=errors&days=3` returns `200`:

```json
{
  "days": 3,
  "metric": "errors",
  "points": [
    {"date": "2026-10-24", "value": 5},
    {"date": "2026-10-25", "value": 2},
    {"date": "2026-10-26", "value": 3}
  ],
  "service": "payments-service"
}
```

Points come oldest first. Dates are `YYYY-MM-DD` in UTC and end today. `days` is the number of points actually returned.

**Errors** are `400` with one message:

```json
{"error":"days must be a positive integer"}
{"error":"unknown metric \"cpu\" (valid: errors, latency_ms)"}
```

The other messages are `missing required query param: service` (or `metric`) and `unknown service "…"`. Unknown paths get `404` and wrong methods `405`, as plain text from Go's router.

## Gateway API

`http://localhost:3000`. Interactive docs, generated from the routes' Zod schemas and drawn by Scalar, are at `/docs`, and the OpenAPI document behind them at `/docs/openapi.json`.

**`GET /health`** returns `200 {"status":"ok"}`.

**`POST /ask`** takes `{"question": "..."}`, at least one character long.

| Status | When | Body |
|---|---|---|
| 501 | the question is valid, until the agent arrives in step 4 | `{"error":{"code":"not_implemented","message":"Not implemented yet."}}` |
| 422 | `question` is missing or empty | `{"error":{"code":"invalid_question","message":"The question is missing or empty."}}` |
| 429 | an IP's 11th request in a minute, counted from its first | `{"error":{"code":"rate_limited","message":"Rate limit exceeded, try again later."}}`, plus a `Retry-After` header in seconds |
| 400 | the body isn't valid JSON, or Fastify rejects the request for another reason | `{"error":{"code":"bad_request","message":"..."}}`, with Fastify's description of the problem |

Every error has the shape [design.md](design.md#the-public-api) plans for the public API, `{"error": {"code": "...", "message": "..."}}`: the code is for programs, and the message is safe to show visitors. An unknown route gets `404` with the code `not_found`, and an unexpected failure gets `500` with `internal_error`. The metrics service uses `{"error": "..."}` instead.

CORS allows only the origins in `ALLOWED_ORIGINS`, and only `GET` and `POST`.

## Configuration

| Service | Settings | Where they come from |
|---|---|---|
| Metrics | `PORT`, default 8080 | the environment only, for example `PORT=8081 make metrics` |
| Gateway | `GEMINI_API_KEY`, `METRICS_BASE_URL`, `ALLOWED_ORIGINS` | the environment, plus `gateway/.env` when started with `make gateway` (see `gateway/.env.example`). A missing or invalid one stops the gateway at startup |

## Known limits

- **The rate limit is per process.** Counts live in memory, so each running copy of the gateway keeps its own, and a restart resets them. Step 4's [daily cap](design.md#the-daily-cap) is shared by every copy.
- **Behind CloudFront and a load balancer,** every request would come from the load balancer's IP, so all visitors would share one limit. Step 3 takes the visitor's IP from CloudFront instead ([ADR-0003](decisions/0003-cloudfront-front-door.md)).
- **The data is 7 hardcoded days.** Step 2 moves it to Postgres, with 30 days of hourly data that always ends today.
- **The metrics service has no auth and allows any origin.** It serves only sample data, and on AWS it will sit in private subnets, reachable only from the gateway.
