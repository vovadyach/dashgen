import assert from "node:assert/strict";
import { type AddressInfo, connect, createServer, type Socket } from "node:net";
import { after, before, describe, it } from "node:test";

import { GetItemCommand } from "@aws-sdk/client-dynamodb";

import { createCapTable, createDailyCap } from "../../src/cap/index.ts";
import { createDynamo } from "../../src/dynamo.ts";
import {
  createTestTable,
  TEST_DYNAMODB_ENDPOINT,
  type TestTable,
} from "../helpers/dynamo.ts";

let testTable: TestTable | undefined;

before(async () => {
  testTable = await createTestTable();
});

after(() => testTable?.drop());

const dynamo = () => {
  assert.ok(testTable);
  return testTable;
};

/** A cap of `limit` questions on the test table, with its clock at `time`. Each test takes a day of its own. */
const capAt = (time: string, limit = 3) =>
  createDailyCap(dynamo().client, {
    table: dynamo().table,
    limit,
    now: () => new Date(time),
  });

/** A fake DynamoDB on a free port. `close()` also ends every connection it tracks. */
async function fakeDynamo(
  onConnection: (socket: Socket, track: (socket: Socket) => void) => void,
) {
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    // A connection the other side resets is expected here, not a failure.
    socket.on("error", () => undefined);
  };
  const server = createServer((socket) => {
    track(socket);
    onConnection(socket, track);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

/** How many questions the test table counted on `day`. */
async function usedOn(day: string) {
  const { Item } = await dynamo().client.send(
    new GetItemCommand({ TableName: dynamo().table, Key: { day: { S: day } } }),
  );
  return Item?.used?.N;
}

describe("daily cap", () => {
  it("takes questions up to the cap, then refuses, saying how long until the next UTC day", async () => {
    const cap = capAt("2026-11-01T22:00:00Z");

    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await cap.reserve());

    assert.deepEqual(answers, [
      { reserved: true },
      { reserved: true },
      { reserved: true },
      // Two hours before midnight UTC.
      { reserved: false, retryAfter: 7_200 },
    ]);
  });

  it("starts the count over each UTC day", async () => {
    const lastSecond = capAt("2026-11-02T23:59:59Z", 1);
    const nextDay = capAt("2026-11-03T00:00:00Z", 1);

    assert.deepEqual(await lastSecond.reserve(), { reserved: true });
    assert.deepEqual(await lastSecond.reserve(), {
      reserved: false,
      retryAfter: 1,
    });
    assert.deepEqual(await nextDay.reserve(), { reserved: true });
  });

  it("gives the last question to only one of two requests that ask at once", async () => {
    const cap = capAt("2026-11-04T12:00:00Z", 1);

    const answers = await Promise.all([cap.reserve(), cap.reserve()]);

    assert.equal(answers.filter((answer) => answer.reserved).length, 1);
  });

  it("sets the day's item to expire 30 days later, for DynamoDB's TTL to delete", async () => {
    const time = "2026-11-05T08:00:00Z";
    await capAt(time).reserve();

    const { Item } = await dynamo().client.send(
      new GetItemCommand({
        TableName: dynamo().table,
        Key: { day: { S: "2026-11-05" } },
      }),
    );
    assert.equal(Item?.used?.N, "1");
    assert.equal(
      Number(Item.expires_at?.N),
      Date.parse(time) / 1_000 + 30 * 24 * 60 * 60,
    );
  });

  it("fails when DynamoDB doesn't answer, so the question can be refused", async () => {
    // Nothing listens on port 1.
    const down = createDynamo("http://127.0.0.1:1");
    try {
      await assert.rejects(createDailyCap(down).reserve());
    } finally {
      down.destroy();
    }
  });

  it(
    "gives up within 2 seconds on a DynamoDB that takes the connection but never answers",
    { timeout: 5_000 },
    async () => {
      const silent = await fakeDynamo(() => undefined);
      const hung = createDynamo(silent.endpoint);
      const started = performance.now();
      try {
        await assert.rejects(createDailyCap(hung).reserve());
      } finally {
        hung.destroy();
        silent.close();
      }
      assert.ok(performance.now() - started < 3_000);
    },
  );

  it(
    "gives up within 2 seconds on a DynamoDB whose reply stalls after its headers, for a question or the table",
    { timeout: 8_000 },
    async () => {
      // Answers each request with its headers and the start of a body, then
      // stops: the client's requestTimeout ends at the headers.
      const stalling = await fakeDynamo((socket) => {
        socket.once("data", () => {
          socket.write(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-amz-json-1.0\r\nContent-Length: 100\r\n\r\n{",
          );
        });
      });
      const client = createDynamo(stalling.endpoint);
      try {
        for (const call of [
          () => createDailyCap(client).reserve(),
          () => createCapTable(client),
        ]) {
          const started = performance.now();
          await assert.rejects(call());
          assert.ok(performance.now() - started < 3_000);
        }
      } finally {
        client.destroy();
        stalling.close();
      }
    },
  );

  it("counts a question once, even when DynamoDB's reply is lost on its way back", async () => {
    // Passes each request on to the test DynamoDB, but drops the first
    // reply: the question was counted, and the backend never hears of it.
    const upstream = new URL(TEST_DYNAMODB_ENDPOINT);
    let replies = 0;
    const lossy = await fakeDynamo((client, track) => {
      const server = connect(Number(upstream.port), upstream.hostname);
      track(server);
      client.pipe(server);
      const drop = replies === 0;
      replies += 1;
      server.on("data", (chunk) => {
        if (drop) {
          client.destroy();
          server.destroy();
        } else {
          client.write(chunk);
        }
      });
    });
    const viaProxy = createDynamo(lossy.endpoint);
    const cap = createDailyCap(viaProxy, {
      table: dynamo().table,
      now: () => new Date("2026-11-07T10:00:00Z"),
    });
    try {
      // The question is refused, since the backend can't know it was counted.
      await assert.rejects(cap.reserve());
    } finally {
      viaProxy.destroy();
      lossy.close();
    }
    assert.equal(await usedOn("2026-11-07"), "1");
  });

  it("makes its table once, and leaves it as it is when it's there already", async () => {
    await capAt("2026-11-06T09:00:00Z").reserve();

    await createCapTable(dynamo().client, dynamo().table);

    // The day's count is still there.
    const cap = capAt("2026-11-06T09:00:00Z", 1);
    assert.equal((await cap.reserve()).reserved, false);
  });
});
