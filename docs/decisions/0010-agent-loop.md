# 10. A hand-written agent loop

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

The agent answers a question in a loop: send the conversation to Gemini, run the tools it calls, send their outputs back, and repeat until a tool ends the run. DashGen needs more from that loop than "repeat until done":

- Limits per question: 6 model calls, retries included, 24,000 input tokens and 25 seconds ([the daily cap](../design.md#the-daily-cap)).
- Its own rules for failures: one retry when retrying can help, a decline when a safety filter blocks the question, and one more try for a reply without a tool call ([when things go wrong](../design.md#when-things-go-wrong)).
- An event per tool call for the page, and every model and tool call kept for the `runs` table.
- Tests that never call Gemini.

The options considered:

- **The Gemini SDK's automatic function calling.** The SDK calls the model again by itself after running the tools it can. Little code, but the steps between calls are hidden, so the limits, the failure rules and the events have nowhere to go.
- **An agent framework,** like the Vercel AI SDK or LangChain.js. They run the loop, with a step limit, retries and many providers. But their retries and step counts work their own way, so the rules above would be written around the framework, and it's a large dependency to learn and keep up to date for one loop.
- **A loop of our own,** over a small `Model` interface: one method, `next(request)`, that returns the model's reply.

## Decision

A hand-written loop: `runAgent` in `backend/src/agent/run.ts`, about 300 lines with its comments. It reaches the model only through the `Model` interface, so Gemini is one adapter (`gemini.ts`), and tests pass a scripted fake model (`test/helpers/model.ts`).

## Consequences

- Every limit and failure rule is plain code with a test. Every request counts toward the limit, since the SDK's own retries stay off.
- The page sees each step as it happens, and the `runs` table gets every model and tool call.
- Another provider means one new adapter, not a new loop, and step 6's evals can compare models through the same interface.
- What frameworks give for free is ours to write: an adapter per provider, and tracing beyond our logs and the `runs` table. Streaming the model's text isn't needed, since every answer is a tool call.
