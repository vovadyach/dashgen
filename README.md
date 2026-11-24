# DashGen

[![CI](https://github.com/vovadyach/dashgen/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/vovadyach/dashgen/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-26-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?logo=fastify&logoColor=white)

Natural-language dashboard generator. Type a question in plain English, an LLM agent decides which tools to call, fetches the data, and renders a chart.

> **Work in progress.** It works locally today: ask a question in the browser, watch the agent's steps arrive, and get the chart. The guardrails and the AWS deploy come next; see the [roadmap](docs/roadmap.md).

## What it will do

You type: *"Show errors for payments-service this week"*

The agent:
1. Calls `query_metrics(service="payments-service", metric="errors", days=7)`
2. Calls `create_chart(type="line", sources=["q1"], title="Payments errors this week")`, naming the query result to draw. The backend fills in the real numbers, so the model never copies data.
3. Streams each step to the page as it happens, then the chart, which the page draws with AG Charts.

Different questions lead to different tool calls. Ask *"What's the slowest service?"* and the agent calls `list_services`, then `query_metrics` for each service, then picks a chart type for the result.

Each question gets one chart. A vague question gets a few complete questions to pick from instead of a guess. Charts you pin form a watchlist saved in your browser, and a copied link carries its chart, so both open even while the backend is offline ([why not a chat](docs/decisions/0002-question-box.md)).

## The data

DashGen comes with made-up sample data, so anyone can try it without bringing their own: error counts and latency for five fake services (`auth-service`, `payments-service`, `checkout-api`, `search-service`, `notifications-worker`). Step 2 puts it in Postgres, filled by a seed script with 30 days of hourly data ending today, so a question about "this week" always has data.

Uploading your own CSV or Excel file is on the roadmap's Later list.

## Architecture

Where it's headed (the [status](#status) table says what exists today):

```
┌─────────────────┐
│   Frontend      │  React + TypeScript + AG Charts
│   (CloudFront)  │  TanStack Query, EventSource
└────────┬────────┘
         │ HTTPS: REST calls, steps streamed over SSE
         ▼
┌─────────────────┐
│   Backend       │  Node.js + Fastify + TypeScript
│   (ECS Fargate) │  modules: api, agent (Gemini or Claude loop), metrics, runs, cap
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
| Backend (`backend/`) | Node.js 26, Fastify, TypeScript, Zod | Takes a question, runs the agent, streams its steps over SSE and saves the run, with a per-IP rate limit, a Cloudflare Turnstile bot check and a daily cap of 150 questions ([API](docs/architecture.md#backend-api)) |
| Database | Postgres 18, Docker Compose | Runs locally: one `dashgen` database, with tables from Drizzle migrations |
| Daily cap | DynamoDB Local, Docker Compose | Runs locally: today's count of questions ([why DynamoDB](docs/decisions/0014-daily-cap-in-dynamodb.md)) |
| Data access | Drizzle | The `metrics` module: 30 days of seeded hourly data, in daily or hourly buckets with a summary ([data](docs/architecture.md#data)) |
| Agent | Gemini (`@google/genai`) or Claude Haiku 5.5 (`@anthropic-ai/sdk`), as `AI_MODEL` says | The [five tools](docs/design.md#the-agents-tools), an adapter for each provider, and the loop that runs them ([why hand-written](docs/decisions/0010-agent-loop.md), [why one setting](docs/decisions/0016-ai-model-setting.md)) |
| MCP server (`backend/src/mcp/`) | `@modelcontextprotocol/sdk`, over stdio, and over HTTP at `/api/mcp` during AWS sessions | Gives Claude Code, Claude chat or any MCP client `list_services`, `query_metrics` and `create_chart`, whose link opens the chart in the page ([how](#ask-dashgen-from-claude), [ADR-0022](docs/decisions/0022-mcp-server.md), [ADR-0023](docs/decisions/0023-remote-mcp.md)) |
| Evals (`backend/evals/`) | Code-graded, on fixed sample data | 27 questions, twice each: 54 of 54 runs right on Claude Haiku 5.5. CI runs them on pull requests that change the agent ([scores](backend/evals/cases.md#scores), [ADR-0018](docs/decisions/0018-agent-evals.md), [ADR-0019](docs/decisions/0019-evals-in-ci.md)) |
| Frontend (`frontend/`) | React, TypeScript, Vite, Tailwind, shadcn/ui, AG Charts, TanStack Query | The question box, the steps as they stream in, and the chart, with a data table, in light and dark themes, on phones too. Charts can be pinned to a watchlist, shared as a link, or downloaded as a PNG. On a slow connection, a small chart draws itself while the page loads |
| Hosting | AWS, Terraform, GitHub Actions | Done (step 5): the budget alerts, the page on CloudFront from a private S3 bucket, the daily cap's table and the image registry stay on. For a work session, `make aws-up` adds the backend on ECS Fargate behind a load balancer, Postgres on RDS and the model's key in Secrets Manager; between sessions, `/api/*` answers that it's offline. GitHub Actions deploys the page and the backend's image after each merge to `main`, signing in to AWS with OIDC ([runbook](docs/runbooks/deploy.md)) |

## Running locally

You'll need Node.js 26.1+, and Docker for Postgres and DynamoDB Local.

```bash
make install                           # install every TypeScript package
cp backend/.env.example backend/.env   # asking a question needs a real key for AI_MODEL (GEMINI_API_KEY by default), and Postgres (below)
make db                                # Postgres and DynamoDB Local, which the backend needs to start
npm run dev                            # the backend on :3000
npm run dev:frontend                   # the page on :5173, in a second terminal
```

Open http://localhost:5173 to ask a question, or http://localhost:3000/docs to try the backend's endpoints in the browser.

With a real key in `backend/.env`, `npm run model:check` sends the model that `AI_MODEL` names two test requests and prints its replies, to show the key and the model work: `GEMINI_API_KEY` for Gemini, the default (free from [Google AI Studio](https://aistudio.google.com)), or `ANTHROPIC_API_KEY` for `claude-haiku-5-5` (free within a Claude Max plan's [API credits](docs/runbooks/costs.md#use-claude-on-the-max-plans-credits)). `npm run model:check -- --json` also prints each reply's JSON, exactly as the provider sent it.

Postgres and DynamoDB Local run in Docker (Docker Desktop or [OrbStack](https://orbstack.dev)):

```bash
cp .env.example .env   # then replace each placeholder with a password
make db                # Postgres on localhost:5432, DynamoDB Local on :8000
npm run db:migrate     # create the tables (set DATABASE_URL in backend/.env first)
npm run db:seed        # 30 days of hourly sample data, ending this hour
```

`npm run cost` prints each day's questions and what they cost, from the `runs` table. The [costs runbook](docs/runbooks/costs.md) has it, how to set Gemini's spend cap, and how to use Claude on a Max plan's credits.

To run the backend the way AWS will, in its container, use `docker compose up`: it starts the databases, applies the migrations and the seed, then starts the backend on :3000. Stop `npm run dev` first, since both use port 3000.

Once Postgres is set up, `make dev` runs everything in one terminal: Postgres, DynamoDB Local, the backend and the page. Ctrl+C stops the backend and the page, and the two databases keep running. DynamoDB Local keeps the daily cap's count in memory, so restarting it starts the count over, and the backend makes its table again when it starts.

`docker compose down` stops them, and `docker compose down --volumes` also deletes Postgres's data. Postgres runs `postgres/init.sh`, which creates the users and the database, only the first time it starts, while its volume is empty. So after changing the passwords in `.env` or the init script, recreate the volume: run `docker compose down --volumes`, then `make db`. Local data is disposable, because the seed recreates it.

> **Upgrading from the two-database setup** (`metrics` and `gateway`): `make db` still reports healthy, but the `dashgen` database doesn't exist. Replace the two old passwords in `.env` with `DASHGEN_DB_PASSWORD`, then recreate the volume as above.

Run every formatter, linter, type checker and test with `make check`, and fix formatting with `make fmt`. Docker must be running: database tests use a throwaway Postgres on port 5433 and DynamoDB Local on 8001, which `make check` starts. GitHub Actions runs the same checks on every pull request and every push to `main`, and after a push to `main` it deploys the page.

## Ask DashGen from Claude

DashGen's tools also work in any MCP client, like Claude Code. Its own model calls them, so DashGen calls no model ([ADR-0022](docs/decisions/0022-mcp-server.md)). It gets `list_services`, `query_metrics` and `create_chart`, which answers with a share link that opens the chart in DashGen's page.

With Postgres running and seeded, as above, add the server once, from the repo root:

```
claude mcp add dashgen -- node --env-file-if-exists="$PWD/backend/.env" "$PWD/backend/src/scripts/mcp.ts"
```

In Claude Code, `/mcp` then shows `dashgen` connected, with 3 tools. Ask, say, "Compare errors across all services this week, as a chart", and open the link it gives.

- **Where links open:** at `PAGE_URL` in `backend/.env`, or on the local page, `http://localhost:5173/`. A link carries the chart itself, so the live page opens it even between AWS sessions.
- **After changing `backend/.env`,** reconnect in `/mcp`: the server reads it only when it starts.
- **No npm in the command:** npm prints a banner on stdout, which carries MCP's messages.

**From Claude chat, or anyone's Claude,** during an AWS session, the backend serves the same tools at `/api/mcp` ([ADR-0023](docs/decisions/0023-remote-mcp.md)). In Claude, open Customize, then Connectors, and add a custom connector. Its URL is your page's address, which `terraform -chdir=infra/aws/always-on output -raw url` prints, followed by `/api/mcp`, and its authentication is "No sign in". Claude connects from Anthropic's cloud, so it works on any plan, even Free, which allows one custom connector, and the thinking is on that person's own plan. Between sessions, the connector gets DashGen's offline answer. Claude Code can connect the same way: `claude mcp add --transport http dashgen-live <that URL>`.

## Repo layout

```
dashgen/
├── .claude/       # Claude Code settings, hooks, skills and a subagent
├── .github/       # CI workflow: runs scripts/check.sh, then deploys the page from main
├── docs/          # architecture, design, roadmap, runbooks and decision records
├── frontend/      # the React page, built with Vite
├── infra/aws/     # Terraform: the account, always-on and session stacks
├── backend/       # the Node.js + Fastify backend, in TypeScript
├── packages/      # shared TypeScript packages: contracts (API schemas)
├── postgres/      # init script: the `dashgen` database and user
├── scripts/       # check.sh: every check in one command; plan-changes.js: what a Terraform plan deletes or replaces
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

- `AGENTS.md` holds the project rules, and `backend/AGENTS.md` and `frontend/AGENTS.md` each part's conventions, for any coding agent, Codex included. Each `CLAUDE.md` imports its folder's `AGENTS.md` (`@AGENTS.md`) and adds only what's specific to Claude Code, so there's one copy of each rule.
- `.claude/settings.json` stops Claude from committing or pushing, so every change is reviewed and committed by hand. It also keeps Claude's file tools, and shell commands like `cat`, away from `.env` files other than `.env.example`. A script that opens a file itself isn't covered; only Claude Code's [sandbox](https://code.claude.com/docs/en/sandboxing) blocks that.
- Hooks, written in TypeScript and run by Node, format each TypeScript, JSON, CSS or HTML file Claude edits, and run `scripts/check.sh` when Claude finishes a turn that changed files. If a check fails, Claude is sent back to fix it, up to twice; after that it stops with a warning.
- Skills: `/fix-issue <number>` works a GitHub issue through to passing checks, and `/adr` records a decision in `docs/decisions/`.
- A subagent: `terraform-reviewer` reads a Terraform plan and reports only what it would delete or replace, before anything is applied.

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
- [12. shadcn/ui and AG Charts for the page](docs/decisions/0012-shadcn-and-ag-charts.md)
- [13. Share links carry the chart](docs/decisions/0013-share-links-carry-the-chart.md)
- [14. The daily cap counts in DynamoDB](docs/decisions/0014-daily-cap-in-dynamodb.md)
- [15. The backend signs in to RDS as its admin user](docs/decisions/0015-backend-as-rds-admin.md)
- [16. One AI_MODEL setting, for Gemini or Claude Haiku 5.5](docs/decisions/0016-ai-model-setting.md)
- [17. The backend's image lives in the always-on stack, and CI builds it](docs/decisions/0017-image-registry-always-on.md)
- [18. The agent's evals are graded by code, on fixed data, and only people run them](docs/decisions/0018-agent-evals.md)
- [19. The evals also run in CI, on pull requests that change the agent](docs/decisions/0019-evals-in-ci.md)
- [20. The page's first paint comes from index.html alone](docs/decisions/0020-first-paint-in-index-html.md)
- [21. A Cloudflare Turnstile check before each question](docs/decisions/0021-turnstile-bot-check.md)
- [22. An MCP server for DashGen's tools, over stdio first](docs/decisions/0022-mcp-server.md)
- [23. The MCP server over HTTP, from the backend during sessions, with no sign-in](docs/decisions/0023-remote-mcp.md)

## License

MIT — see [LICENSE](./LICENSE).
