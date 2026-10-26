# DashGen

Type a question in plain English, get a chart. A Gemini agent in the gateway picks tools, fetches the metrics and returns the chart. `README.md` describes the design; `docs/roadmap.md` is the plan.

## Layout

- `gateway/`: Python + FastAPI gateway, where the agent will live. See `gateway/CLAUDE.md`.
- `metrics/`: Go service that serves the sample metrics. See `metrics/CLAUDE.md`.
- `frontend/`: React + Vite app, empty until step 5.
- `docs/roadmap.md`: the nine steps. Tick an item when it's done.
- `docs/decisions/`: ADRs. Write new ones with `/adr`.

## Commands

- `make check` runs every formatter, linter, type checker and test. The stop hook runs it when you finish a turn that changed files, and CI (`.github/workflows/ci.yml`) runs it on every pull request. It must pass.
- `make metrics` and `make gateway` start the services on :8080 and :3000.
- `/fix-issue <number>` works a GitHub issue through to passing checks.

## Rules

- Never commit, push or open PRs. The user reviews and commits everything, so leave changes uncommitted and list what changed.
- Ask before adding a dependency, in any language.
- Run Python through uv (`uv run`, `uv add`), never `python` or `pip` directly.
- Never read or edit `.env` files, not even through a script: they hold secrets. Put every new setting in `.env.example` with a placeholder.
- The repo is public. No keys, secrets or personal details in any file.
- A choice someone could question (a library, a data model, a trade-off) gets an ADR.

## AWS (from step 3)

- All infrastructure is Terraform; nothing is changed only in the console.
- GitHub Actions reaches AWS through OIDC. No AWS keys in GitHub.
- Never create an AWS Organization or Control Tower: that ends the Free plan and its credits.
- Run `terraform destroy` at the end of every AWS work session.
