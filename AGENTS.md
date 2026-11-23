# DashGen

Type a question in plain English, get a chart. An agent in the backend, on Gemini or Claude (`AI_MODEL`), picks tools, fetches the metrics and returns the chart. `README.md` describes the design; `docs/roadmap.md` is the plan.

These rules are for every coding agent. Claude Code reads them through `CLAUDE.md`, which imports this file.

## Layout

- `backend/`: the one Node.js + Fastify service, in TypeScript, where the agent lives. See `backend/AGENTS.md`.
- `packages/contracts/`: Zod schemas shared between packages, imported as `@dashgen/contracts`. The root `package.json` makes `backend`, `frontend` and `packages/*` one npm workspace, with the shared tools and settings ([ADR-0004](docs/decisions/0004-npm-workspaces.md)).
- `frontend/`: the React page, built with Vite. See `frontend/AGENTS.md`.
- `compose.yaml` and `postgres/`: Postgres and DynamoDB Local in Docker for local development. Postgres has one `dashgen` database and user, and DynamoDB Local holds the daily cap's count, in memory.
- `infra/aws/`: Terraform, a folder per stack. `account/` is for the AWS account itself, like the budget alerts and the state bucket ([runbook](docs/runbooks/aws-account.md#6-terraform-takes-over)), `always-on/` for the parts of DashGen that stay on between sessions, like CloudFront and the daily cap's table ([runbook](docs/runbooks/deploy.md#the-always-on-stack)), and `session/` for what runs only during a work session, like the VPC ([runbook](docs/runbooks/deploy.md#the-session-stack)).
- `docs/architecture.md`: what runs today, and its API. Update it whenever an API changes.
- `docs/design.md`: the target design, with requirements, estimates and diagrams. Update it when a design choice changes.
- `docs/roadmap.md`: the nine steps. Tick an item when it's done.
- `docs/decisions/`: ADRs, numbered, in the format of the existing ones.

## Commands

- `make check` runs every formatter, linter, type checker and test. Run it before you finish any change: it must pass, and CI (`.github/workflows/ci.yml`) runs it on every pull request. After a push to `main`, CI also deploys the page.
- `make install` runs `npm ci` at the root, which installs every TypeScript workspace and the shared tools.
- `make fmt` formats the TypeScript code.
- `make dev` starts Postgres, DynamoDB Local, the backend and the page in one terminal, and Ctrl+C stops the backend and the page. To start one alone, `npm run dev` starts the backend on :3000, and `npm run dev:frontend` the page on :5173, which forwards `/api` to the backend. `make` is for repo-wide and infrastructure commands, npm scripts for the TypeScript packages.
- `docker compose up` runs the backend in its container too, as AWS will: it builds `backend/Dockerfile`, applies the migrations and the seed, then starts the backend on :3000.
- `make db` starts Postgres on localhost:5432 and DynamoDB Local on localhost:8000 in Docker, with Postgres's passwords from the root `.env` that the user makes from `.env.example`. Don't create that file: for a test run, set `POSTGRES_PASSWORD` and `DASHGEN_DB_PASSWORD` as environment variables instead.
- `npm run db:migrate` and `npm run db:seed` create the tables and the sample data. After a schema change, `npm run db:generate --workspace backend -- --name <change>` writes the SQL migration to commit with it. Never run `npx drizzle-kit` itself: it reads `backend/.env`, which `generate` doesn't need. Never edit a migration that has been merged; add a new one.
- `npm run cost` prints each UTC day's questions and what they cost, from the `runs` table (`docs/runbooks/costs.md`).
- `npm run model:check` sends two real requests to the model that `AI_MODEL` names, Gemini or Claude, to check the key, the model and the request format. Only the user runs it (see Rules).
- `npm run eval` runs the agent on its 27 eval cases, twice each, on the model that `AI_MODEL` names, and prints the score ([ADR-0018](docs/decisions/0018-agent-evals.md), `backend/evals/cases.md`). It calls the model for real, about $0.05 for all 54 runs, so only the user runs it (see Rules), and CI on pull requests that change the agent, failing when a case is wrong in both runs (`.github/workflows/evals.yml`, [ADR-0019](docs/decisions/0019-evals-in-ci.md)). It needs the test Postgres that `make check` starts, and its results stay in `.claude/hillclimb/agent/`, out of git.
- The MCP server (`backend/src/scripts/mcp.ts`) gives DashGen's tools to an MCP client, like Claude Code, over stdio ([ADR-0022](docs/decisions/0022-mcp-server.md)). The client starts it. To add it to Claude Code, from the repo root: `claude mcp add dashgen -- node --env-file-if-exists="$PWD/backend/.env" "$PWD/backend/src/scripts/mcp.ts"`. It has no npm script, since npm prints a banner on stdout, which carries MCP's messages. It needs Postgres from `make db`, with the sample data, and reads only `DATABASE_URL` and `LOG_LEVEL`. It calls no model: the client's own model calls the tools.
- `make check` also starts a throwaway test Postgres on port 5433 and DynamoDB Local on 8001 (`compose.test.yaml`), so Docker must be running. `npm run test:unit` runs only the tests that need neither.

## Rules

- Never commit, push or open PRs. The user reviews and commits everything, so leave changes uncommitted and list what changed.
- Ask before adding a dependency, in any language.
- Never read or edit `.env` files, not even through a script: they hold secrets. Put every new setting in `.env.example` with a placeholder.
- Never call Gemini or Claude: every request is billed to the user's key. Only the user runs `npm run model:check` or `npm run eval`, or sends questions to a running backend. CI runs the evals on the user's pull requests that change the agent. Tests use the fake model in `backend/test/helpers/model.ts`, and a fake of each provider's API.
- The repo is public. No keys, secrets or personal details in any file.
- A choice someone could question (a library, a data model, a trade-off) gets an ADR.

## AWS (from step 5)

- All infrastructure is Terraform; nothing is changed only in the console.
- GitHub Actions reaches AWS through OIDC. No AWS keys in GitHub.
- Never create an AWS Organization or Control Tower: that ends the Free plan and its credits.
- End every AWS work session with `make aws-down`, which destroys only the session stack, `infra/aws/session`. Never run `terraform destroy` on `infra/aws/account` or `infra/aws/always-on`, which stay.
- Before any `terraform apply`, check its plan for anything it would delete or replace, and tell the user. From the repo's root, `terraform -chdir=infra/aws/<stack> show -json tfplan | node scripts/plan-changes.js` prints only those.
- If an `aws-up` plan replaces `aws_secretsmanager_secret.model_api_key` because its name changes, stop at the plan. Switch between Gemini and Claude after ending the current session with `make aws-down`. Both Gemini models share the same secret and can switch during a session.
