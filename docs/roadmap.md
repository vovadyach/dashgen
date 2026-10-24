# Roadmap

DashGen is built in five steps. Each one ends with something that works end to end.
The reasoning behind bigger choices lives in [decisions](decisions/).

## 1. Foundation

- [x] Metrics service in Go with hardcoded data
- [ ] Move the gateway from Node.js to Python + FastAPI ([ADR-0001](decisions/0001-python-gateway.md))
- [ ] Tests for the metrics service and the gateway
- [ ] `scripts/check.sh`: one command that runs every formatter, linter, type checker and test
- [ ] CI on GitHub Actions that runs `scripts/check.sh`
- [ ] Claude Code setup: a `CLAUDE.md` per service, permissions, format and stop hooks, `fix-issue` and `adr` skills
- [ ] README brought up to date

**Done when:** `scripts/check.sh` passes locally and in CI, and failing checks send Claude back to fix them before it finishes.

## 2. The agent

- [ ] Chart format: what the gateway returns and the frontend draws
- [ ] Tools: `list_services`, `query_metrics`, `create_chart`
- [ ] Hand-written Gemini function-calling loop with a step limit, timeouts and a record of each step
- [ ] Model name in config
- [ ] Tests against a scripted fake model, so no API calls

**Done when:** "Show errors for payments-service this week" returns a valid chart and the steps that produced it.

## 3. Frontend

- [ ] React + Vite + Tailwind + Recharts: chat box, chart, thinking panel
- [ ] TypeScript API types generated from the gateway's OpenAPI schema
- [ ] Component tests with Vitest

**Done when:** the README's example query works end to end locally.

## 4. Ship

- [ ] Metrics service and gateway on Railway, frontend on Vercel
- [ ] Rate limiting keyed on the real client IP behind Railway's proxy
- [ ] Spending cap and a deploy runbook (`docs/runbooks/deploy.md`)
- [ ] Live link and demo GIF in the README

**Done when:** anyone can open the live link and use it.

## 5. Depth

- [ ] Evals: 30–50 test questions with known correct tool calls and chart types, scored for accuracy
- [ ] Stream the agent's steps to the UI as they happen (SSE)
- [ ] Log tokens and latency per request

**Done when:** the README reports the agent's eval accuracy.
