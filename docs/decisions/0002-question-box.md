# 2. A question box, not a chat

- **Status:** Accepted
- **Date:** 2026-10-24

## Context

DashGen turns a question into a chart. The Express scaffold named its endpoint `POST /chat` and the README described a "chat input", but no UI had been built yet.

Two shapes were considered:

- **Question box:** one input field. Each question returns one chart, and the next question starts fresh.
- **Chat:** a conversation. Charts appear inside messages, and follow-ups like "now make it a bar chart" refer to earlier messages.

## Decision

Use a question box.

- Each request carries one question and nothing else. The gateway keeps no conversation history.
- Visitors pin the charts they want to keep. The pinned charts form their dashboard, saved in the browser.
- A vague question gets a clarifying question with clickable choices. Each choice is a complete question, so the next request still stands alone.
- The endpoint is `POST /ask`, not `POST /chat`.

## Consequences

- Cost per question stays flat. A chat resends the whole conversation to the model with every message, so each message costs more than the one before.
- The gateway is stateless: there is no session storage, and any gateway instance can answer any request.
- Evals are single-turn: one question, the expected tool calls and the expected chart.
- Follow-ups don't work. If they're added later, it will be as a "change this chart" box on each chart that sends only that chart, not a whole conversation.
