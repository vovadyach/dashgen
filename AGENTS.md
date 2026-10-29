# DashGen

Type a question in plain English, get a chart. A Gemini agent in the backend picks tools, fetches the metrics and returns the chart. `README.md` describes the design; `docs/roadmap.md` is the plan.

These rules are for every coding agent. Claude Code reads them through `CLAUDE.md`, which imports this file.

## Layout

- `backend/`: the one Node.js + Fastify service, in TypeScript, where the agent lives. See `backend/AGENTS.md`.
- `packages/contracts/`: Zod schemas shared between packages, imported as `@dashgen/contracts`. The root `package.json` makes `backend` and `packages/*` one npm workspace, with the shared tools and settings ([ADR-0004](docs/decisions/0004-npm-workspaces.md)).
- `frontend/`: React + Vite app, empty until step 3.
- `compose.yaml` and `postgres/`: Postgres in Docker for local development, with one `dashgen` database and user.
- `docs/architecture.md`: what runs today, and its API. Update it whenever an API changes.
- `docs/design.md`: the target design, with requirements, estimates and diagrams. Update it when a design choice changes.
- `docs/roadmap.md`: the nine steps. Tick an item when it's done.
- `docs/decisions/`: ADRs, numbered, in the format of the existing ones.

## Commands

- `make check` runs every formatter, linter, type checker and test. Run it before you finish any change: it must pass, and CI (`.github/workflows/ci.yml`) runs it on every pull request.
- `make install` runs `npm ci` at the root, which installs every TypeScript workspace and the shared tools.
- `make fmt` formats the TypeScript code.
- `npm run dev` starts the backend on :3000. `make` is for repo-wide and infrastructure commands, npm scripts for the TypeScript packages.
- `make db` starts Postgres in Docker on localhost:5432, with the passwords from the root `.env` that the user makes from `.env.example`. Don't create that file: for a test run, set `POSTGRES_PASSWORD` and `DASHGEN_DB_PASSWORD` as environment variables instead.
- `npm run db:migrate` and `npm run db:seed` create the tables and the sample data. After a schema change, `npm run db:generate --workspace backend -- --name <change>` writes the SQL migration to commit with it. Never run `npx drizzle-kit` itself: it reads `backend/.env`. Never edit a migration that has been merged; add a new one.
- `npm run gemini:check` sends two real requests to Gemini, to check the key, the model and the request format. It reads the key from `backend/.env`, so only the user runs it, never an agent.
- `make check` also starts a throwaway test Postgres on port 5433 (`compose.test.yaml`), so Docker must be running. `npm run test:unit` runs only the tests that need no database.

## Rules

- Never commit, push or open PRs. The user reviews and commits everything, so leave changes uncommitted and list what changed.
- Ask before adding a dependency, in any language.
- Never read or edit `.env` files, not even through a script: they hold secrets. Put every new setting in `.env.example` with a placeholder.
- The repo is public. No keys, secrets or personal details in any file.
- A choice someone could question (a library, a data model, a trade-off) gets an ADR.

## AWS (from step 5)

- All infrastructure is Terraform; nothing is changed only in the console.
- GitHub Actions reaches AWS through OIDC. No AWS keys in GitHub.
- Never create an AWS Organization or Control Tower: that ends the Free plan and its credits.
- Run `terraform destroy` at the end of every AWS work session.
