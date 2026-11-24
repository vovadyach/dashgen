# 23. The MCP server over HTTP, from the backend during sessions, with no sign-in

- **Status:** Accepted
- **Date:** 2026-11-23

## Context

[ADR-0022](0022-mcp-server.md) planned DashGen's 3 MCP tools over HTTP too, for Claude chat's custom connectors. Claude connects to those from Anthropic's cloud, so the server must be on the public internet, on HTTPS. The options were:

- **Where:** a service that's always on, or the backend, during AWS sessions.
- **Sign-in:** OAuth, a fixed key in a header, or none.
- **State:** none, with each request alone, sessions in the backend's memory, or sessions in DynamoDB.
- **The rate limit:** per IP, as for questions, or per MCP session.
- **Web pages:** let browsers call it, with CORS, or refuse them.

## Decision

- **At `/api/mcp`, in the backend, during sessions.** CloudFront sends it on like the rest of `/api/*`, and passes MCP's 3 headers, `Mcp-Session-Id`, `MCP-Protocol-Version` and `Accept`, and `Origin`. Between sessions it answers 503, as it does for the page.
- **No sign-in.** The data is read-only sample data, and the tools call no model, so a caller can cost DashGen only database reads. Claude's connectors allow "No sign in".
- **No web pages.** A request whose `Origin` isn't Claude's gets a 403, as MCP's spec asks, so no page can use a visitor's browser to call it, as by DNS rebinding to a backend on localhost. Apps like Claude Code send no `Origin`. Claude's requests come from Anthropic's servers, and Claude's docs warn that a strict check can turn them down, so `https://claude.ai` and `https://claude.com` pass. No browser calls it, so it needs no CORS.
- **Sessions in the backend's memory,** each with its own MCP server and results, as over stdio. With no state, `create_chart` couldn't chart a query from an earlier request.
- **One message and one JSON answer per request, and no streams:** the tools answer at once, and CloudFront would cut a stream that stays open. A batch of messages gets 400, so each tool call counts toward the rate limit, and a `GET` gets 405.
- **Limits:** 50 sessions at once, those still starting too, with a 503 past that. A session ends after 30 idle minutes or on `DELETE`, then gets a 404, so its client starts a new one. There are 60 requests a minute per session, and per IP for any other request, like one with a made-up session ID, or from a web page. The limit counts per session because every Claude chat user comes from Anthropic's cloud: per IP, a few users could use up everyone's requests.

## Consequences

- Anyone can try DashGen from their own Claude, on any plan, during a session. Their plan pays for the model, and DashGen only for the session's hours.
- The sessions live in one task's memory, so a deploy or a restart ends them all, and clients start new ones on the 404. More than one task would need shared sessions, such as in DynamoDB.
- 50 sessions of 60 requests a minute are enough for a demo, not a crowd: past 50, a new session waits for one to end.
- With no sign-in, the logs know a caller only by its session and IP, and for Claude chat that's Anthropic's IP.
- If Claude's requests ever name an origin other than those two, Claude chat gets the 403 until it's added. The backend logs each origin it refuses.
- On AWS the backend needs `PAGE_URL`, or its links would open localhost. So a session from before this keeps its old backend until its next `make aws-up`.
- CloudFront's policy for `/api/*` passes 4 more headers to the backend, a change to the always-on stack.
