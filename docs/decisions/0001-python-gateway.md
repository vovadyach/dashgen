# 1. Python and FastAPI for the gateway

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

The gateway runs the LLM agent. It sends the user's question to Gemini, runs the tool calls the model asks for, and returns a chart config to the frontend.

A Node.js + Express scaffold existed: config loading, CORS, rate limiting and a `/chat` stub. No agent code had been written yet.

Most LLM tooling, SDK examples and evaluation libraries are Python-first. The frontend is TypeScript and the metrics service is Go.

## Decision

Rewrite the gateway in Python with FastAPI before building the agent.

- **uv** manages dependencies and the Python version.
- **FastAPI + uvicorn** serve the HTTP API.
- **pydantic-settings** loads typed configuration from environment variables.
- **limits** counts requests for rate limiting, wrapped in a FastAPI dependency.
- **pytest, ruff and mypy** handle tests, formatting and linting, and type checking.
- **google-genai**, the official Gemini SDK, is added with the agent in step 4.

## Consequences

- The agent is built in the language the LLM ecosystem centers on, and the eval suite can live next to it in pytest.
- Each layer uses a language suited to it: TypeScript for the UI, Python for the agent, Go for the data service.
- The frontend can't share TypeScript types with the gateway. Its API types are generated from FastAPI's OpenAPI schema instead.
- The ~60-line Node scaffold is thrown away. Switching now costs almost nothing; after the agent exists it would be a rewrite.
