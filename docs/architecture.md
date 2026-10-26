# Architecture

What runs today: how DashGen's services fit together, and each one's API. [design.md](design.md) works out the target design and the reasons for it, the [roadmap](roadmap.md) says what comes next, and the [decisions](decisions/) record why.

## The pieces

```
Browser ──▶ Gateway ──▶ Metrics ──▶ Postgres
           (the agent)   (the data)
```

Today the metrics service and the gateway run. The frontend, Postgres and the agent are still planned, and the README's [status table](../README.md#status) says in which step.

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

`http://localhost:3000`. FastAPI serves interactive docs, generated from the code, at `/docs`.

**`GET /health`** returns `200 {"status":"ok"}`.

**`POST /ask`** takes `{"question": "..."}`, at least one character long.

| Status | When | Body |
|---|---|---|
| 501 | the question is valid, until the agent arrives in step 4 | `{"detail":"Not implemented yet."}` |
| 422 | `question` is missing or empty | `{"detail":[{"type":"missing","loc":["body","question"],"msg":"Field required","input":{}}]}` |
| 429 | an IP's 11th request within a minute | `{"detail":"Rate limit exceeded, try again later."}`, plus a `Retry-After` header in seconds |

Errors use FastAPI's shape, `{"detail": ...}`: a string for errors the code raises, a list for validation errors. The metrics service uses `{"error": "..."}` instead.

CORS allows only the origins in `ALLOWED_ORIGINS`, and only `GET` and `POST`.

## Configuration

| Service | Settings | Where they come from |
|---|---|---|
| Metrics | `PORT`, default 8080 | the environment only, for example `PORT=8081 make metrics` |
| Gateway | `GEMINI_API_KEY`, `METRICS_BASE_URL`, `ALLOWED_ORIGINS` | the environment or `gateway/.env` (see `gateway/.env.example`). A missing one stops the gateway at startup |

## Known limits

- **The rate limit is per process.** Counts live in memory, so each running copy of the gateway keeps its own, and a restart resets them. Step 4's daily Gemini cap is counted in Postgres, so every copy shares it.
- **Behind a load balancer**, the client IP has to come from the forwarded headers, or every visitor shares one limit (step 3).
- **The data is 7 hardcoded days.** Step 2 moves it to Postgres, with 30 days of hourly data that always ends today.
- **The metrics service has no auth and allows any origin.** It serves only sample data, and on AWS it will sit in private subnets, reachable only from the gateway.
