# DashGen

[![CI](https://github.com/vovadyach/dashgen/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/vovadyach/dashgen/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?logo=fastify&logoColor=white)

Natural-language dashboard generator. Type a question in plain English, an LLM agent decides which tools to call, fetches the data, and renders a chart.

> **Work in progress.** The backend works today: it takes a question, runs the Gemini agent and streams its steps. The frontend and the AWS deploy come next; see the [roadmap](docs/roadmap.md).

## What it will do

You type: *"Show errors for payments-service this week"*

The agent:
1. Calls `query_metrics(service="payments-service", metric="errors", days=7)`
2. Calls `create_chart(type="line", sources=["q1"], title="Payments errors this week")`, naming the query result to draw. The backend fills in the real numbers, so the model never copies data.
3. Streams each step to the page as it happens, then the chart, which the page draws with Recharts.

Different questions lead to different tool calls. Ask *"What's the slowest service?"* and the agent calls `list_services`, then `query_metrics` for each service, then picks a chart type for the result.

Each question gets one chart. A vague question gets a few complete questions to pick from instead of a guess. Charts you pin form a dashboard saved in your browser ([why not a chat](docs/decisions/0002-question-box.md)).

## The data

DashGen comes with made-up sample data, so anyone can try it without bringing their own: error counts and latency for five fake services (`auth-service`, `payments-service`, `checkout-api`, `search-service`, `notifications-worker`). Step 2 puts it in Postgres, filled by a seed script with 30 days of hourly data ending today, so a question about "this week" always has data.

Uploading your own CSV or Excel file is on the roadmap's Later list.

## Architecture

Where it's headed (the [status](#status) table says what exists today):

```
┌─────────────────┐
│   Frontend      │  React + TypeScript + Recharts
│   (CloudFront)  │  TanStack Query, EventSource
└────────┬────────┘
         │ HTTPS: REST calls, steps streamed over SSE
         ▼
┌─────────────────┐
│   Backend       │  Node.js + Fastify + TypeScript
│   (ECS Fargate) │  modules: api, agent (Gemini loop), metrics, runs, cap
└────────┬────────┘
         │ SQL through Drizzle
         ▼
┌─────────────────┐
│   Postgres      │  metric time series and the log of questions
│   (RDS)         │
└─────────────────┘
```

**Two parts, each doing one job:**
- **Frontend:** question box, the steps as they happen, the chart, pinned charts
- **Backend:** one service that runs the agent, answers its metric queries and enforces the limits. Its modules talk as function calls, and could become separate services if they ever need to ([why one backend](docs/decisions/0005-one-backend.md))

More detail: [docs/architecture.md](docs/architecture.md) covers what runs today, including each API, and [docs/design.md](docs/design.md) the target design, with requirements, cost estimates and diagrams.

## Status

| Part | Tech | Today |
|---|---|---|
| Backend (`backend/`) | Node.js 24, Fastify, TypeScript, Zod | Takes a question, runs the agent, streams its steps over SSE and saves the run, with a per-IP rate limit ([API](docs/architecture.md#backend-api)) |
| Database | Postgres 18, Docker Compose | Runs locally: one `dashgen` database, with tables from Drizzle migrations |
| Data access | Drizzle | The `metrics` module: 30 days of seeded hourly data, in daily or hourly buckets with a summary ([data](docs/architecture.md#data)) |
| Agent | Gemini (`@google/genai`) | The [five tools](docs/design.md#the-agents-tools), the Gemini adapter and the loop that runs them ([why hand-written](docs/decisions/0010-agent-loop.md)) |
| Frontend | React, TypeScript, Vite, Tailwind, Recharts, TanStack Query | Planned (step 3) |
| Hosting | AWS, Terraform | Planned (step 5) |

## Running locally

You'll need Node.js 24.16+, and Docker for Postgres.

```bash
make install                           # install every TypeScript package
cp backend/.env.example backend/.env   # asking a question needs a real GEMINI_API_KEY, and Postgres (below)
npm run dev                            # the backend on :3000
```

Open http://localhost:3000/docs to try the backend's endpoints in the browser.

With a real `GEMINI_API_KEY` in `backend/.env` (free from [Google AI Studio](https://aistudio.google.com)), `npm run gemini:check` sends Gemini two test requests and prints its replies, to show the key and the model work. `npm run gemini:check -- --json` also prints each reply's JSON, exactly as Gemini sent it.

Postgres runs in Docker (Docker Desktop or [OrbStack](https://orbstack.dev)):

```bash
cp .env.example .env   # then replace each placeholder with a password
make db                # Postgres on localhost:5432
npm run db:migrate     # create the tables (set DATABASE_URL in backend/.env first)
npm run db:seed        # 30 days of hourly sample data, ending this hour
```

`docker compose down` stops it, and `docker compose down --volumes` also deletes its data. Postgres runs `postgres/init.sh`, which creates the users and the database, only the first time it starts, while its volume is empty. So after changing the passwords in `.env` or the init script, recreate the volume: run `docker compose down --volumes`, then `make db`. Local data is disposable, because the seed recreates it.

> **Upgrading from the two-database setup** (`metrics` and `gateway`): `make db` still reports healthy, but the `dashgen` database doesn't exist. Replace the two old passwords in `.env` with `DASHGEN_DB_PASSWORD`, then recreate the volume as above.

Run every formatter, linter, type checker and test with `make check`, and fix formatting with `make fmt`. Docker must be running: database tests use a throwaway Postgres on port 5433, which `make check` starts. GitHub Actions runs the same checks on every pull request and every push to `main`.

## Repo layout

```
dashgen/
├── .claude/       # Claude Code settings, hooks and skills
├── .github/       # CI workflow: runs scripts/check.sh
├── docs/          # architecture, design, roadmap and decision records
├── frontend/      # React + Vite app (planned)
├── backend/       # the Node.js + Fastify backend, in TypeScript
├── packages/      # shared TypeScript packages: contracts (API schemas)
├── postgres/      # init script: the `dashgen` database and user
├── scripts/       # check.sh: every check in one command
├── AGENTS.md      # project rules for every coding agent
├── CLAUDE.md      # imports AGENTS.md, plus Claude Code's own bits
├── compose.yaml   # Postgres for local development
├── compose.test.yaml  # throwaway Postgres for tests
├── Makefile
├── package.json   # npm workspace: the shared tools and scripts
└── tsconfig.base.json  # TypeScript settings every package extends
```

## Working with Claude Code

The repo is set up for [Claude Code](https://claude.com/claude-code):

- `AGENTS.md` holds the project rules, and `backend/AGENTS.md` the backend's conventions, for any coding agent, Codex included. Each `CLAUDE.md` imports its folder's `AGENTS.md` (`@AGENTS.md`) and adds only what's specific to Claude Code, so there's one copy of each rule.
- `.claude/settings.json` stops Claude from committing or pushing, so every change is reviewed and committed by hand. It also keeps Claude's file tools, and shell commands like `cat`, away from `.env` files other than `.env.example`. A script that opens a file itself isn't covered; only Claude Code's [sandbox](https://code.claude.com/docs/en/sandboxing) blocks that.
- Hooks, written in TypeScript and run by Node, format each TypeScript file Claude edits, and run `scripts/check.sh` when Claude finishes a turn that changed files. If a check fails, Claude is sent back to fix it, up to twice; after that it stops with a warning.
- Skills: `/fix-issue <number>` works a GitHub issue through to passing checks, and `/adr` records a decision in `docs/decisions/`.

## Decisions

- [1. Node.js, Fastify and TypeScript for the gateway](docs/decisions/0001-node-gateway.md)
- [2. A question box, not a chat](docs/decisions/0002-question-box.md)
- [3. CloudFront as the front door, with no domain](docs/decisions/0003-cloudfront-front-door.md)
- [4. npm workspaces for the TypeScript code](docs/decisions/0004-npm-workspaces.md)
- [5. One TypeScript backend, with modules inside](docs/decisions/0005-one-backend.md)
- [6. Drizzle for data access](docs/decisions/0006-drizzle.md)
- [7. tRPC between the React app and the backend](docs/decisions/0007-trpc.md), replaced by 11
- [8. Postgres for the metrics and the runs](docs/decisions/0008-postgres.md)
- [9. UUIDv7 for IDs](docs/decisions/0009-uuidv7-ids.md)
- [10. A hand-written agent loop](docs/decisions/0010-agent-loop.md)
- [11. REST and SSE between the React app and the backend](docs/decisions/0011-rest-and-sse.md)

## License

MIT — see [LICENSE](./LICENSE).
