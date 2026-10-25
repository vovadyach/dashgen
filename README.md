# DashGen

![Python](https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)

Natural-language dashboard generator. Type a question in plain English, an LLM agent decides which tools to call, fetches the data, and renders a chart.

> **Work in progress.** The Go metrics service and the gateway's skeleton run today. The agent, the frontend and the AWS deploy come next; see the [roadmap](docs/roadmap.md).

## What it will do

You type: *"Show errors for payments-service this week"*

The agent:
1. Calls `query_metrics(service="payments-service", metric="errors", days=7)`
2. Calls `create_chart(type="line", data=[...], title="Payments errors this week")`
3. Returns the chart to the frontend, which draws it with Recharts.

Different questions lead to different tool calls. Ask *"What's the slowest service?"* and the agent calls `list_services`, then `query_metrics` for each service, then picks a chart type for the result.

Each question gets one chart. A vague question gets a few complete questions to pick from instead of a guess. Charts you pin form a dashboard saved in your browser ([why not a chat](docs/decisions/0002-question-box.md)).

## The data

DashGen comes with made-up sample data, so anyone can try it without bringing their own: error counts and latency for five fake services (`auth-service`, `payments-service`, `checkout-api`, `search-service`, `notifications-worker`). Today that's 7 days hardcoded in the Go service. In step 2 it moves to Postgres, filled by a seed script with 30 days of hourly data ending today, so a question about "this week" always has data.

Uploading your own CSV or Excel file is on the roadmap's Later list.

## Architecture

Where it's headed (the [status](#status) table says what exists today):

```
┌─────────────────┐
│   Frontend      │  React + TypeScript + Recharts
│   (CloudFront)  │
└────────┬────────┘
         │ HTTPS
         ▼
┌─────────────────┐
│   Gateway       │  Python + FastAPI
│   (ECS Fargate) │  Gemini function-calling loop
└────────┬────────┘
         │ HTTP (private network)
         ▼
┌─────────────────┐
│   Metrics       │  Go (net/http stdlib)
│   (ECS Fargate) │  Time-series data in Postgres (RDS)
└─────────────────┘
```

**Three services, each doing one job:**
- **Frontend** — question box, chart display, steps panel
- **Gateway** — runs the agent: calls the tools, returns the chart
- **Metrics** — a small REST API over the sample metrics

Both backend services keep their data in Postgres, each in its own tables: the metrics service owns the time series, and the gateway owns the log of agent runs. Everything runs on AWS, built with Terraform: the frontend on S3 + CloudFront, the services on ECS Fargate, and Postgres on RDS.

## Status

| Part | Tech | Today |
|---|---|---|
| Metrics (`metrics/`) | Go 1.25+, standard library | `GET /health`, `GET /services`, `GET /metrics?service=&metric=&days=` over hardcoded data |
| Gateway (`gateway/`) | Python 3.14, FastAPI, uv | `GET /health`, and `POST /ask` with a per-IP rate limit, which answers 501 until the agent exists |
| Database | Postgres | Planned (step 2) |
| Hosting | AWS, Terraform | Planned (step 3) |
| Agent | Gemini (`google-genai`) | Planned (step 4) |
| Frontend | React, TypeScript, Vite, Tailwind, Recharts | Planned (step 5) |

## Running locally

You'll need Go 1.25+ and [uv](https://docs.astral.sh/uv/), which installs the right Python version for you.

```bash
make install                           # install the gateway's packages
cp gateway/.env.example gateway/.env   # any placeholder works for GEMINI_API_KEY for now
make metrics                           # terminal 1: metrics service on :8080
make gateway                           # terminal 2: gateway on :3000
```

Open http://localhost:3000/docs to try the gateway's endpoints in the browser.

Run every formatter, linter, type checker and test with `make check`.

## Repo layout

```
dashgen/
├── .claude/    # Claude Code settings, hooks and skills
├── docs/       # roadmap and decision records
├── frontend/   # React + Vite app (planned)
├── gateway/    # Python + FastAPI gateway
├── metrics/    # Go metrics service
├── scripts/    # check.sh: every check in one command
├── CLAUDE.md   # project rules for Claude Code
└── Makefile
```

## Working with Claude Code

The repo is set up for [Claude Code](https://claude.com/claude-code):

- `CLAUDE.md` holds the project rules, and `gateway/CLAUDE.md` and `metrics/CLAUDE.md` hold each service's conventions.
- `.claude/settings.json` stops Claude from committing or pushing, so every change is reviewed and committed by hand. It also keeps Claude's file tools, and shell commands like `cat`, away from `.env` files other than `.env.example`. A script that opens a file itself isn't covered; only Claude Code's [sandbox](https://code.claude.com/docs/en/sandboxing) blocks that.
- Hooks format each Python or Go file Claude edits, and run `scripts/check.sh` when Claude finishes a turn that changed files. If a check fails, Claude is sent back to fix it, up to twice; after that it stops with a warning.
- Skills: `/fix-issue <number>` works a GitHub issue through to passing checks, and `/adr` records a decision in `docs/decisions/`.

## Decisions

- [1. Python and FastAPI for the gateway](docs/decisions/0001-python-gateway.md)
- [2. A question box, not a chat](docs/decisions/0002-question-box.md)

## License

MIT — see [LICENSE](./LICENSE).
