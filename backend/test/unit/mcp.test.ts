import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";

import { MAX_QUERIES } from "../../src/agent/validation.ts";
import { createMcpServer } from "../../src/mcp/index.ts";
import type { Metrics } from "../../src/metrics/index.ts";
import { CHECKOUT_QUERY } from "../fixtures/agent.ts";
import { CATALOG } from "../fixtures/metrics.ts";
import { recordingLogger } from "../helpers/logger.ts";
import { downMetrics, fakeMetrics } from "../helpers/metrics.ts";

/** An MCP client connected to DashGen's server on `metrics`, in memory, as Claude Code is over stdio. */
async function connect(metrics: Metrics) {
  const { log, lines } = recordingLogger();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(metrics, { log }).connect(serverSide);
  await client.connect(clientSide);
  return { client, lines };
}

/** A tool's answer: one block of text, which may be an error. */
const Answer = z.object({
  content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
  isError: z.boolean().optional(),
});

/** Calls the tool `name`, and returns its text, and whether it's an error. */
async function call(
  client: Client,
  name: string,
  args?: Record<string, unknown>,
) {
  const { content, isError = false } = Answer.parse(
    await client.callTool({ name, arguments: args }),
  );
  return { text: content[0].text, isError };
}

/** A query_metrics answer: its result ID, and how many points it has. */
const QueryAnswer = z.object({ id: z.string(), points: z.number() });

describe("createMcpServer", () => {
  it("offers list_services and query_metrics, with the agent's own descriptions", async () => {
    const { client } = await connect(fakeMetrics());

    const { tools } = await client.listTools();

    assert.deepEqual(
      tools.map(({ name }) => name),
      ["list_services", "query_metrics"],
    );
    const [list, query] = tools;
    assert.ok(list && query);
    assert.match(
      list.description ?? "",
      /^Lists the services and metrics you can query/,
    );
    assert.deepEqual(list.inputSchema.properties ?? {}, {});
    assert.match(
      query.description ?? "",
      /^Fetches one metric for one service/,
    );
    await client.close();
  });

  it("turns the agent's Zod schema into the JSON Schema that the client's model reads", async () => {
    const { client } = await connect(fakeMetrics());

    const { tools } = await client.listTools();

    const query = tools.find(({ name }) => name === "query_metrics");
    assert.ok(query);
    const { properties = {}, required } = query.inputSchema;
    assert.deepEqual(Object.keys(properties), [
      "service",
      "metric",
      "days",
      "bucket",
    ]);
    // days has a default, 7, and bucket one that suits the days.
    assert.deepEqual(required, ["service", "metric"]);
    // A strict object, so a misspelled argument is an error, never dropped.
    assert.equal(query.inputSchema.additionalProperties, false);
    // Each field keeps its description, which tells the model what to send.
    assert.match(
      JSON.stringify(properties.service),
      /A service name from list_services/,
    );
    await client.close();
  });

  it("answers list_services with the catalog, as JSON, with or without an empty arguments object", async () => {
    const { client } = await connect(fakeMetrics());

    for (const args of [{}, undefined]) {
      const { text, isError } = await call(client, "list_services", args);

      assert.equal(isError, false);
      assert.equal(text, JSON.stringify(CATALOG));
    }
    await client.close();
  });

  it("turns down arguments a tool doesn't take, as an error the client's model can read", async () => {
    const { client } = await connect(fakeMetrics());

    const { text, isError } = await call(client, "list_services", {
      service: "payments-service",
    });

    assert.equal(isError, true);
    assert.match(text, /Input validation error/);
    await client.close();
  });

  it("answers query_metrics with a result ID and a summary, never the points, and gives each call the next ID", async () => {
    const { client } = await connect(fakeMetrics());

    const first = await call(client, "query_metrics", CHECKOUT_QUERY);
    const second = await call(client, "query_metrics", CHECKOUT_QUERY);

    assert.equal(QueryAnswer.parse(JSON.parse(first.text)).id, "q1");
    const answer = QueryAnswer.parse(JSON.parse(second.text));
    assert.equal(answer.id, "q2");
    // A count: the points stay with DashGen, for create_chart.
    assert.ok(answer.points > 0);
    await client.close();
  });

  it("answers an unknown service with an error that names the known ones, for the client's model to correct", async () => {
    const { client } = await connect(fakeMetrics());

    const { text, isError } = await call(client, "query_metrics", {
      ...CHECKOUT_QUERY,
      service: "billing",
    });

    assert.equal(isError, true);
    assert.match(text, /^Unknown service "billing"\. Known services: /);
    await client.close();
  });

  it("makes more queries than a question's limit, since an MCP session asks DashGen no question", async () => {
    const { client } = await connect(fakeMetrics());

    for (let i = 1; i <= MAX_QUERIES + 1; i++) {
      const { text, isError } = await call(
        client,
        "query_metrics",
        CHECKOUT_QUERY,
      );

      assert.equal(isError, false);
      assert.equal(QueryAnswer.parse(JSON.parse(text)).id, `q${String(i)}`);
    }
    await client.close();
  });

  it("answers a failure it didn't expect without its details, and logs it without the query's values", async () => {
    const { client, lines } = await connect(downMetrics());

    const { text, isError } = await call(client, "list_services", {});

    assert.equal(isError, true);
    assert.equal(
      text,
      "DashGen couldn't run list_services. Try again in a moment.",
    );
    assert.deepEqual(
      lines.map(({ level, msg }) => ({ level, msg })),
      [{ level: "error", msg: "mcp tool failed" }],
    );
    const logged = lines[0]?.obj;
    assert.ok(logged && "err" in logged && logged.err instanceof Error);
    assert.match(logged.err.message, /^Failed query: select/);
    assert.doesNotMatch(logged.err.message, /payments-service/);
    await client.close();
  });
});
