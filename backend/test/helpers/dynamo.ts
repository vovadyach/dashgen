import { randomUUIDv7 } from "node:crypto";

import {
  DeleteTableCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";

import { createCapTable } from "../../src/cap/index.ts";
import { createDynamo } from "../../src/dynamo.ts";

// The throwaway DynamoDB Local from compose.test.yaml, which `make check`
// starts. TEST_DYNAMODB_ENDPOINT points the tests at another one instead.
export const TEST_DYNAMODB_ENDPOINT =
  process.env.TEST_DYNAMODB_ENDPOINT ?? "http://127.0.0.1:8001";

export interface TestTable {
  client: DynamoDBClient;
  table: string;
  drop: () => Promise<void>;
}

/** Creates a fresh daily cap table for one test file. Call `drop()` after its tests. */
export async function createTestTable(): Promise<TestTable> {
  // A random name, so test files running in parallel never share a table.
  const table = `test-${randomUUIDv7()}`;
  const client = createDynamo(TEST_DYNAMODB_ENDPOINT);
  const drop = async () => {
    try {
      await client.send(new DeleteTableCommand({ TableName: table }));
    } finally {
      client.destroy();
    }
  };

  try {
    await createCapTable(client, table);
    return { client, table, drop };
  } catch (error) {
    // Without this, a failed setup would keep the process alive.
    client.destroy();
    throw error;
  }
}
