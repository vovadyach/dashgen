# 22. An MCP server for DashGen's tools, over stdio first

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

Roadmap step 8 asks for an MCP client, like Claude Code, that answers metrics questions with DashGen's own tools. The agent already has five, for its own loop ([ADR-0010](0010-agent-loop.md)): `list_services`, `query_metrics`, `create_chart`, `clarify` and `decline`. The options were:

- **The transport:** stdio, where the client starts the server on its own machine, or Streamable HTTP, a remote server that clients reach by its URL, like Claude chat's custom connectors.
- **The protocol:** the official TypeScript SDK, `@modelcontextprotocol/sdk`, or its JSON-RPC messages by hand.
- **The tools:** all five, or the three that fetch and draw.
- **Where it runs:** a service of its own, or the backend.

## Decision

- **Stdio first, then HTTP.** `npm run mcp` serves the tools over stdio, against the local Postgres, for Claude Code on a developer's machine. Then the backend serves the same tools over Streamable HTTP during AWS sessions, for Claude chat. Only the transport differs.
- **The official SDK, 1.32.2,** as a dependency of the backend, not a dev dependency, since the HTTP version runs in the backend's image. The protocol's details, like its versions and messages, stay the SDK's job.
- **Three tools: `list_services`, `query_metrics` and `create_chart`,** from the agent's own definitions, so their names, schemas and checks can't drift apart. `clarify` and `decline` stay out: the client's model can ask its user, or refuse, by itself.
- **`create_chart` answers with a share link** ([ADR-0013](0013-share-links-carry-the-chart.md)), which draws the chart in DashGen's page with no backend, so it opens even between sessions.
- **The code is a module of the backend, `backend/src/mcp/`,** which reuses the metrics module, as the agent does ([ADR-0005](0005-one-backend.md)).

## Consequences

- An MCP client can answer DashGen's questions, and DashGen pays for no model call: the client's model does the thinking. The HTTP version costs only the session's hours.
- Stdio works only on a machine with the repo, Docker and the sample data, so it's for developers. Claude chat's users need the HTTP version, which is up only during sessions, and needs a rate limit of its own, since anyone can call it.
- The SDK brings 17 direct dependencies into the backend's image, like express and hono, mostly for HTTP servers and sign-in. That's more to keep up to date, and more code that could have a security hole.
- Over stdio, stdout carries the protocol's messages, so the server's logs must go to stderr.
- The agent's limit on queries counts per question. An MCP client asks DashGen no question, so its tools need limits of their own.
