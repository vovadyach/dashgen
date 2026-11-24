import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it, type TestContext } from "node:test";
import { setTimeout as wait } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { McpLimits } from "../../../src/api/index.ts";
import { CHECKOUT_QUERY } from "../../fixtures/agent.ts";
import { startApp } from "../../helpers/app.ts";

/** The backend, listening on a free port, as on AWS behind CloudFront, and its MCP address. */
async function startServer(t: TestContext, mcp: McpLimits = {}) {
  const app = await startApp(
    t,
    {},
    { mcp, env: { PAGE_URL: "https://dashgen.example/" } },
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${String(port)}/api/mcp`);
}

/** What a client sends with each request, as MCP's spec asks. */
const HEADERS = {
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
};

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

const LIST_TOOLS = { jsonrpc: "2.0", id: 2, method: "tools/list" };

/**
 * One request, by hand, with the session's ID once it has one. Like the SDK's
 * own client, it names a content type only with a body: a DELETE has none.
 */
function send(
  url: URL,
  body: unknown,
  session?: string,
  method = "POST",
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      ...HEADERS,
      ...(body !== undefined && { "content-type": "application/json" }),
      ...(session && { "mcp-session-id": session }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

/** Starts a session by hand, and returns its ID. */
async function startSession(url: URL): Promise<string> {
  const response = await send(url, INITIALIZE);
  assert.equal(response.status, 200);
  const session = response.headers.get("mcp-session-id");
  assert.ok(session);
  return session;
}

/**
 * Keeps each request the server's transport answers open after it writes the
 * answer, as when an answer is slow to finish, until the returned function
 * lets them all end.
 */
function holdRequests(t: TestContext): () => void {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handleRequest = Object.getOwnPropertyDescriptor(
    StreamableHTTPServerTransport.prototype,
    "handleRequest",
  )?.value as StreamableHTTPServerTransport["handleRequest"];
  t.mock.method(
    StreamableHTTPServerTransport.prototype,
    "handleRequest",
    async function (
      this: StreamableHTTPServerTransport,
      ...args: Parameters<StreamableHTTPServerTransport["handleRequest"]>
    ) {
      await handleRequest.apply(this, args);
      await held;
    },
  );
  return release;
}

/** A create_chart answer: the chart's link. */
const ChartAnswer = z.object({
  content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
});

describe("the MCP server over HTTP, at /api/mcp", () => {
  it("serves the 3 tools to a client, and keeps a session's results between requests, so a chart can use them", async (t) => {
    const url = await startServer(t);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url));
    t.after(() => client.close());

    const { tools } = await client.listTools();
    await client.callTool({ name: "query_metrics", arguments: CHECKOUT_QUERY });
    const chart = await client.callTool({
      name: "create_chart",
      arguments: { type: "line", sources: ["q1"], title: "Errors" },
    });

    assert.deepEqual(
      tools.map(({ name }) => name),
      ["list_services", "query_metrics", "create_chart"],
    );
    // q1 came from the request before, in the same session.
    const [{ text }] = ChartAnswer.parse(chart).content;
    assert.match(text, /"link":"https:\/\/dashgen\.example\/#chart=/);
  });

  it("starts a session only with an initialize request, and tells each answer's request ID and rate limit", async (t) => {
    const url = await startServer(t);

    const refused = await send(url, LIST_TOOLS);
    const started = await send(url, INITIALIZE);

    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /initialize request first/);
    assert.equal(started.status, 200);
    // The transport writes a session's answers itself, with the headers of
    // Fastify's hooks too.
    for (const response of [refused, started]) {
      assert.ok(response.headers.get("x-request-id"));
      assert.equal(response.headers.get("x-ratelimit-limit"), "60");
    }
  });

  it("refuses a web page's request with a 403, as MCP's spec asks, but takes Claude's, and an app's, which names no origin", async (t) => {
    const url = await startServer(t);
    const session = await startSession(url);

    const page = await send(url, LIST_TOOLS, session, "POST", {
      origin: "https://page.example",
    });
    const claude = await send(url, INITIALIZE, undefined, "POST", {
      origin: "https://claude.ai",
    });

    assert.equal(page.status, 403);
    assert.match(await page.text(), /no requests from web pages/);
    assert.equal(claude.status, 200);
  });

  it("answers a session it doesn't know with a 404, as MCP's spec asks, so the client starts a new one", async (t) => {
    const url = await startServer(t);

    const response = await send(url, LIST_TOOLS, "no-such-session");

    assert.equal(response.status, 404);
  });

  it("refuses GET, since DashGen sends no messages of its own, but answers an ended session's with a 404", async (t) => {
    const url = await startServer(t);
    const session = await startSession(url);

    const open = await send(url, undefined, session, "GET");
    await send(url, undefined, session, "DELETE");
    const ended = await send(url, undefined, session, "GET");

    assert.equal(open.status, 405);
    assert.equal(open.headers.get("allow"), "POST, DELETE");
    assert.equal(ended.status, 404);
  });

  it("answers a GET with a protocol version it doesn't support with a 400, as MCP's spec asks, not the 405", async (t) => {
    const url = await startServer(t);
    const session = await startSession(url);

    const response = await send(url, undefined, session, "GET", {
      "mcp-protocol-version": "1999-01-01",
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /Unsupported protocol version/);
  });

  it("takes one message a request, as MCP's spec asks, so the rate limit counts each tool call", async (t) => {
    const url = await startServer(t);
    const session = await startSession(url);

    const batch = await send(
      url,
      [LIST_TOOLS, { ...LIST_TOOLS, id: 3 }],
      session,
    );

    assert.equal(batch.status, 400);
    assert.match(await batch.text(), /one message a request/);
  });

  it("refuses a new session past its limit, until one ends", async (t) => {
    const url = await startServer(t, { maxSessions: 1 });
    const first = await startSession(url);

    const refused = await send(url, INITIALIZE);
    await send(url, undefined, first, "DELETE");
    const next = await send(url, INITIALIZE);

    assert.equal(refused.status, 503);
    assert.equal(refused.headers.get("retry-after"), "60");
    assert.equal(next.status, 200);
  });

  it("counts a session once from the moment it starts, however long its initialize request takes to end", async (t) => {
    const url = await startServer(t, { maxSessions: 2 });
    const release = holdRequests(t);

    // Each is answered, while its request stays open.
    const answers = [];
    for (let i = 0; i < 3; i++) {
      answers.push((await send(url, INITIALIZE)).status);
    }
    release();

    assert.deepEqual(answers, [200, 200, 503]);
  });

  it("frees the place of a session whose initialize request fails", async (t) => {
    const url = await startServer(t, { maxSessions: 1 });

    // MCP's spec asks clients to take JSON and a stream: the SDK refuses this
    // one before the session gets an ID.
    const failed = await send(url, INITIALIZE, undefined, "POST", {
      accept: "application/json",
    });
    const next = await send(url, INITIALIZE);

    assert.equal(failed.status, 406);
    assert.equal(next.status, 200);
  });

  it("ends a session on DELETE, and after its idle time, so its memory is freed", async (t) => {
    const url = await startServer(t, { idleMs: 50 });
    const deleted = await startSession(url);
    const idle = await startSession(url);

    const ended = await send(url, undefined, deleted, "DELETE");
    await wait(100);

    assert.equal(ended.status, 200);
    assert.equal((await send(url, LIST_TOOLS, deleted)).status, 404);
    assert.equal((await send(url, LIST_TOOLS, idle)).status, 404);
  });

  it("counts its rate limit per session, so clients that share an IP, as Claude chat's do, don't share a limit", async (t) => {
    const url = await startServer(t, { perMinute: 3 });
    const busy = await startSession(url);
    const other = await startSession(url);

    const answers = [];
    for (let i = 0; i < 4; i++) {
      answers.push((await send(url, LIST_TOOLS, busy)).status);
    }
    const otherAnswer = await send(url, LIST_TOOLS, other);

    assert.deepEqual(answers, [200, 200, 200, 429]);
    assert.equal(otherAnswer.status, 200);
  });

  it("counts a session ID it doesn't hold by IP, so made-up ones can't skip the limit", async (t) => {
    const url = await startServer(t, { perMinute: 3 });

    const answers = [];
    for (let i = 0; i < 4; i++) {
      answers.push(
        (await send(url, LIST_TOOLS, `made-up-${String(i)}`)).status,
      );
    }

    assert.deepEqual(answers, [404, 404, 404, 429]);
  });

  it("counts a web page's requests by IP, so they can't use up a session's limit", async (t) => {
    const url = await startServer(t, { perMinute: 3 });
    const session = await startSession(url);

    const page = [];
    for (let i = 0; i < 2; i++) {
      const answer = await send(url, LIST_TOOLS, session, "POST", {
        origin: "https://page.example",
      });
      page.push(answer.status);
    }
    const own = [];
    for (let i = 0; i < 3; i++) {
      own.push((await send(url, LIST_TOOLS, session)).status);
    }

    assert.deepEqual(page, [403, 403]);
    assert.deepEqual(own, [200, 200, 200]);
  });
});
