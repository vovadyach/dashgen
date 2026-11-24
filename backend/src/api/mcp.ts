// /api/mcp: DashGen's tools for MCP clients over Streamable HTTP, like Claude
// chat's custom connectors, during AWS sessions (ADR-0023). Each client gets
// a session of its own: the same server as over stdio (ADR-0022), with its
// own results, so create_chart can chart what its queries fetched.
import { randomUUIDv7 } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { createMcpServer } from "../mcp/index.ts";
import type { Metrics } from "../metrics/index.ts";

/** How many sessions, for how long, and how many requests: memory and load stay bounded. */
export interface McpLimits {
  /** Sessions at once, those still starting too. Past it, a new one is refused until one ends. */
  maxSessions?: number;
  /** A session ends after this long with no request. */
  idleMs?: number;
  /** Requests a minute, per session, or per IP for any other request. */
  perMinute?: number;
}

export interface McpRoutesOptions extends McpLimits {
  /** A Metrics for a new session, on the real clock: a session lasts too long for a fixed one. */
  metrics: () => Metrics;
  /** Where create_chart's links open. */
  pageUrl: string;
  /** The visitor's IP, for the rate limit of a request that no session counts. */
  visitorIp: (request: FastifyRequest) => string;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

const MINUTE_MS = 60_000;

/**
 * The only web origins it takes requests from: Claude's. MCP's spec asks for
 * a 403 to any other, so no web page can use a visitor's browser to call it,
 * as by DNS rebinding to a backend on localhost. Apps like Claude Code send
 * no Origin, and Claude's docs warn that a strict check can turn down
 * Claude's own requests, which come from Anthropic's servers.
 */
const CLAUDE_ORIGINS = new Set(["https://claude.ai", "https://claude.com"]);

export const mcpRoutes: FastifyPluginCallbackZod<McpRoutesOptions> = (
  app,
  {
    metrics,
    pageUrl,
    visitorIp,
    maxSessions = 50,
    idleMs = 30 * MINUTE_MS,
    perMinute = 60,
  },
  done,
) => {
  const sessions = new Map<string, Session>();
  // Sessions whose initialize request is still being answered. Each moves to
  // the map as soon as its transport gives it an ID, so it never holds two
  // places, however long its answer takes to finish.
  const starting = new Set<Session>();

  const endIdle = () => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastSeen <= idleMs) continue;
      sessions.delete(id);
      session.transport.close().catch((err: unknown) => {
        app.log.warn({ err }, "an idle mcp session didn't close cleanly");
      });
    }
  };
  // Also once a minute, so an idle backend frees them too.
  const sweep = setInterval(endIdle, Math.min(idleMs, MINUTE_MS));
  sweep.unref();
  app.addHook("onClose", async () => {
    clearInterval(sweep);
    await Promise.all(
      [...sessions.values()].map(({ transport }) => transport.close()),
    );
    sessions.clear();
  });

  /** A session for an initialize request, which its transport moves to the map. */
  function newSession(): Session {
    const transport: StreamableHTTPServerTransport =
      new StreamableHTTPServerTransport({
        // A UUIDv7, like DashGen's other IDs (ADR-0009): after its 48 bits
        // of time come 74 random ones, too many to guess another's session.
        sessionIdGenerator: () => randomUUIDv7(),
        // One JSON answer a request, and no stream: the tools answer at once,
        // and CloudFront would cut a stream that stays open.
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          starting.delete(session);
          sessions.set(id, session);
        },
      });
    const session: Session = { transport, lastSeen: Date.now() };
    transport.onclose = () => {
      if (transport.sessionId !== undefined) {
        sessions.delete(transport.sessionId);
      }
    };
    return session;
  }

  /** The session's transport answers the request, which it writes itself. */
  async function serve(
    session: Session,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    session.lastSeen = Date.now();
    // Hooks set headers on Fastify's reply, like the request ID and the rate
    // limit's, which the transport's answer would otherwise leave out.
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    // So Fastify must not write one too.
    reply.hijack();
    try {
      await session.transport.handleRequest(
        request.raw,
        reply.raw,
        request.body,
      );
    } catch (err) {
      request.log.error({ err }, "mcp request failed");
      if (!reply.raw.headersSent) {
        reply.raw
          .writeHead(500, { "content-type": "application/json" })
          .end(JSON.stringify(rpcError("Internal error.")));
      }
    }
  }

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    // MCP's own spec describes it, not the API's OpenAPI document.
    schema: { hide: true },
    config: {
      rateLimit: {
        max: perMinute,
        timeWindow: "1 minute",
        // Per session: every Claude chat user comes from Anthropic's cloud,
        // so per IP, a few of them could use up everyone's requests. Only a
        // request it takes, for a session it holds, counts there: one with
        // a made-up ID, or from a web page, counts by IP, so it can't skip
        // the limit or use up a session's.
        keyGenerator: (request) => {
          const id = sessionId(request);
          return id !== undefined &&
            sessions.has(id) &&
            fromClaudeOrApp(request)
            ? `session:${id}`
            : `ip:${visitorIp(request)}`;
        },
      },
    },
    handler: async (request, reply) => {
      endIdle();
      // First, so a web page learns nothing, not even which sessions exist.
      if (!fromClaudeOrApp(request)) {
        request.log.warn(
          { origin: request.headers.origin },
          "mcp request from a web page refused",
        );
        return refuse(
          reply,
          403,
          "DashGen's MCP server takes no requests from web pages.",
        );
      }
      const id = sessionId(request);
      const session = id === undefined ? undefined : sessions.get(id);
      // An ended session, whatever the method: MCP's spec asks for a 404, so
      // the client starts a new one.
      if (id !== undefined && !session) {
        return refuse(reply, 404, "This session has ended. Start a new one.");
      }
      if (request.method === "GET") {
        // MCP's spec asks for a 400 to a version it doesn't support, which
        // the SDK checks on every other request.
        const version = header(request, "mcp-protocol-version");
        if (
          version !== undefined &&
          !SUPPORTED_PROTOCOL_VERSIONS.includes(version)
        ) {
          return refuse(
            reply,
            400,
            `Unsupported protocol version: ${version}. DashGen takes ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`,
          );
        }
        // DashGen sends no messages of its own, so it has no stream to open.
        return refuse(
          reply,
          405,
          "DashGen's MCP server takes POST and DELETE.",
          {
            allow: "POST, DELETE",
          },
        );
      }
      // One message a request, as MCP's spec asks, so the rate limit counts
      // each tool call. The SDK would still take an older version's batch.
      if (Array.isArray(request.body)) {
        return refuse(reply, 400, "Send one message a request.");
      }
      if (session) return serve(session, request, reply);

      if (request.method !== "POST" || !isInitializeRequest(request.body)) {
        return refuse(
          reply,
          400,
          "Start a session with an initialize request first.",
        );
      }
      // Sessions still starting count too, or initialize requests that come
      // together could all pass the limit.
      if (sessions.size + starting.size >= maxSessions) {
        return refuse(
          reply,
          503,
          "DashGen has as many MCP sessions as it takes. Try again in a minute.",
          { "retry-after": "60" },
        );
      }
      const started = newSession();
      starting.add(started);
      try {
        await createMcpServer(metrics(), { log: app.log, pageUrl }).connect(
          started.transport,
        );
        await serve(started, request, reply);
      } finally {
        // One whose initialize failed, before it got an ID, frees its place.
        starting.delete(started);
      }
    },
  });
  done();
};

/** Whether a request comes from Claude, or from an app, which names no origin, rather than from a web page. */
function fromClaudeOrApp(request: FastifyRequest): boolean {
  const { origin } = request.headers;
  return origin === undefined || CLAUDE_ORIGINS.has(origin);
}

/** The request's MCP session, which the client sends once it has one. */
function sessionId(request: FastifyRequest): string | undefined {
  return header(request, "mcp-session-id");
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

/** A JSON-RPC error with no request ID, the shape MCP's transport answers with. */
function rpcError(message: string) {
  return { jsonrpc: "2.0", error: { code: -32000, message }, id: null };
}

function refuse(
  reply: FastifyReply,
  status: number,
  message: string,
  headers: Record<string, string> = {},
) {
  return reply.code(status).headers(headers).send(rpcError(message));
}
