# DashGen

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-2.5_Flash-4285F4?logo=googlegemini&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-deployed-000000?logo=vercel&logoColor=white)
![Railway](https://img.shields.io/badge/Railway-deployed-0B0D0E?logo=railway&logoColor=white)

Natural-language dashboard generator. Type a question in plain English, an LLM agent decides which tools to call, fetches the data, and renders a chart.

**Live demo:** _coming soon_
**Demo video:** _coming soon_

## What it does

User types: *"Show errors for payments-service this week"*

The agent:
1. Calls `query_metrics(service="payments-service", metric="errors", days=7)`
2. Calls `create_chart(type="line", data=[...], title="Payments Errors This Week")`
3. Returns a chart config to the frontend, which renders it with Recharts.

Different queries trigger different tool sequences. Ask *"What's the slowest service?"* and the agent calls `list_services`, then `query_metrics` for each, then picks a chart type to display the result.

## Architecture

```
┌─────────────────┐
│   Frontend      │  React + TypeScript + Recharts
│   (Vercel)      │
└────────┬────────┘
         │ HTTPS
         ▼
┌─────────────────┐
│   Gateway       │  Node.js + Express
│   (Railway)     │  Gemini 2.5 Flash function-calling loop
└────────┬────────┘
         │ HTTPS
         ▼
┌─────────────────┐
│   Metrics       │  Go (net/http stdlib)
│   (Railway)     │  In-memory hardcoded time-series data
└─────────────────┘
```

**Three services, each doing one job:**
- **Frontend** — chat input, chart display, agent thinking panel
- **Gateway** — orchestrates the LLM, runs tool calls, returns final config
- **Metrics** — exposes a small REST API over hardcoded fake observability data

## Stack

| Layer | Tech |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind, Recharts |
| Gateway | Node.js, Express, TypeScript, `@google/genai` |
| Metrics | Go 1.26+ stdlib (`net/http`) |
| LLM | Gemini 2.5 Flash (free tier, function calling) |
| Hosting | Vercel (frontend), Railway (gateway + metrics) |

## Repo layout

```
dashgen/
├── frontend/   # React + Vite app
├── gateway/    # Node.js Express server
├── metrics/    # Go HTTP service
└── README.md
```

Each service is independently deployable. See the README in each folder for service-specific setup.

## Running locally

You'll need: Node 20+, Go 1.26+, a Gemini API key from [Google AI Studio](https://aistudio.google.com/).

Or use the Makefile: `make metrics`, `make gateway`, `make frontend` in separate terminals.

**Terminal 1 — metrics service:**
```bash
cd metrics
go run .
# listens on :8080
```

**Terminal 2 — gateway:**
```bash
cd gateway
cp .env.example .env   # add your GEMINI_API_KEY
npm install
npm run dev
# listens on :3000
```

**Terminal 3 — frontend:**
```bash
cd frontend
npm install
npm run dev
# opens on :5173
```

## Tools the agent has

The LLM is given three tools and decides which to call based on the user's question:

- `list_services()` — returns the names of available services
- `query_metrics(service, metric, days)` — returns time-series data
- `create_chart(type, data, title)` — packages data into a chart config (`line`, `bar`, or `pie`)

Tool definitions and schemas live in `gateway/src/tools.ts`.

## Tradeoffs and production considerations

This was built in a weekend to demonstrate the agent pattern. Honest notes on what's missing for production:

**Hardcoded data instead of a real store.**
Production would use a time-series database (Prometheus, ClickHouse, or InfluxDB) — relational DBs aren't a great fit for high-cardinality observability data.

**No streaming.**
Tool calls happen server-side and the final config arrives in one response. Streaming the agent's intermediate steps to the UI via SSE would make the experience feel more responsive.

**No eval framework.**
A real agent needs a golden dataset of queries → expected tool sequences and accuracy tracking, so prompt or model changes can be evaluated for regressions.

**Basic rate limiting; no auth.**
The gateway rate-limits at 10 req/min per IP via `express-rate-limit`, and Railway has a hard spending cap as a backstop. There's no authentication — the demo is public. Production would add authenticated per-user rate limits, scoped tool access by user permissions, and likely Cloudflare in front for DDoS protection.

**No sandboxed tool execution.**
Tools run directly in the gateway process. Production agents need isolated execution environments — agents can't be trusted to call arbitrary tools with arbitrary inputs. Firecracker microVMs or gVisor are typical choices.

**Single integration test.**
Smoke check only. Production needs full unit and integration coverage, contract tests between services, and an evaluation suite for the agent itself.

## What I'd build next

In rough priority order:
1. Stream tool calls to the UI in real time (SSE) so the "thinking" panel updates live.
2. Eval framework — 50 queries → expected tool sequences → accuracy metric.
3. Replace in-memory data with a real time-series store.
4. Sandboxed tool execution.
5. Multi-step reasoning (e.g., *"Find the worst service and break it down"*).

## License

MIT — see [LICENSE](./LICENSE).
