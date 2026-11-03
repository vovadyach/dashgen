import {
  ConditionalCheckFailedException,
  CreateTableCommand,
  type DynamoDBClient,
  ResourceInUseException,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

import { DEFAULT_DAILY_CAP } from "../config.ts";
import { requestDeadline } from "../dynamo.ts";

/** The daily cap's table: an item per UTC day, with the questions it used. */
export const CAP_TABLE = "dashgen-daily-cap";

const DAY_SECONDS = 24 * 60 * 60;

/** Whether a question got one of today's places, and if not, how long until tomorrow's. */
export type Reservation =
  | { reserved: true }
  | {
      reserved: false;
      /** Seconds until the next UTC day, when the count starts over. */
      retryAfter: number;
    };

/** The daily cap: today's count of questions, kept outside the session's database. */
export interface DailyCap {
  /** Questions a day, for every visitor together. */
  readonly limit: number;
  /**
   * Takes one of today's questions, before any work starts. It's never given
   * back, even when the run fails, since a failed run may already have spent
   * tokens. Rejects when DynamoDB doesn't answer, or its reply is lost: then
   * the question may have taken a place anyway, and that place is lost.
   */
  reserve(): Promise<Reservation>;
}

export interface DailyCapOptions {
  table?: string;
  /** Questions a day. Tests pass a few. */
  limit?: number;
  /** The clock, so tests can fix it. */
  now?: () => Date;
}

export function createDailyCap(
  client: DynamoDBClient,
  {
    table = CAP_TABLE,
    limit = DEFAULT_DAILY_CAP,
    now = () => new Date(),
  }: DailyCapOptions = {},
): DailyCap {
  return {
    limit,
    async reserve() {
      const time = now();
      const seconds = Math.floor(time.getTime() / 1_000);
      try {
        // One conditional write: the day's first question creates its item,
        // and later ones add 1 only while it's under the cap. DynamoDB checks
        // and writes in one step, so two requests can't both take the last
        // question.
        await client.send(
          new UpdateItemCommand({
            TableName: table,
            Key: { day: { S: time.toISOString().slice(0, 10) } },
            UpdateExpression: "ADD used :one SET expires_at = :expires",
            ConditionExpression: "attribute_not_exists(used) OR used < :cap",
            ExpressionAttributeValues: {
              ":one": { N: "1" },
              ":cap": { N: String(limit) },
              // On AWS, TTL is on for expires_at (infra/aws/always-on), so
              // DynamoDB deletes the day's item some time after this.
              ":expires": { N: String(seconds + 30 * DAY_SECONDS) },
            },
          }),
          { abortSignal: requestDeadline() },
        );
        return { reserved: true };
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
        return {
          reserved: false,
          retryAfter: DAY_SECONDS - (seconds % DAY_SECONDS),
        };
      }
    },
  };
}

/** Creates the daily cap's table, unless it's there already. */
export async function createCapTable(
  client: DynamoDBClient,
  table = CAP_TABLE,
): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: table,
        AttributeDefinitions: [{ AttributeName: "day", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "day", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      }),
      { abortSignal: requestDeadline() },
    );
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) throw error;
  }
}
