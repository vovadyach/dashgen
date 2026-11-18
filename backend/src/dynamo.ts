import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";

/** How long a request to DynamoDB may take, to the last byte of its reply. */
const TIMEOUT_MS = 2_000;

/** Shared by both clients. */
const NO_RETRY_WITH_TIMEOUTS = {
  // No retry: the daily cap's write adds 1, and a second try after a lost
  // reply would count one question twice. The question is refused instead.
  maxAttempts: 1,
  requestHandler: {
    connectionTimeout: 1_000,
    // A request with no reply at all fails, even one sent without
    // requestDeadline(). Without throwOnRequestTimeout, the SDK would only
    // log a warning, and keep waiting.
    requestTimeout: TIMEOUT_MS,
    throwOnRequestTimeout: true,
  },
} satisfies DynamoDBClientConfig;

/**
 * A client for DynamoDB Local at `endpoint`. Its keys are fake: DynamoDB Local
 * takes any, and fake ones can't reach a real AWS account, even on a machine
 * that has real keys. Close it with `client.destroy()`.
 */
export function createDynamo(endpoint: string): DynamoDBClient {
  return new DynamoDBClient({
    endpoint,
    region: "local",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
    ...NO_RETRY_WITH_TIMEOUTS,
  });
}

/**
 * A client for AWS's own DynamoDB in `region`, for the backend on ECS. The SDK
 * finds the task's role by itself, and requests go through the VPC's gateway
 * endpoint (infra/aws/session). Close it with `client.destroy()`.
 */
export function createAwsDynamo(region: string): DynamoDBClient {
  return new DynamoDBClient({ region, ...NO_RETRY_WITH_TIMEOUTS });
}

/**
 * Sends one request with `send`, and rejects 2 seconds after it starts,
 * however far it has come. Every send goes through it, as
 * `withDeadline((abortSignal) => client.send(command, { abortSignal }))`.
 *
 * The signal ends the request itself, even a reply that stalls after its
 * headers, where the client's own requestTimeout stops counting. But it can't
 * end the credential lookup before it, which on ECS asks the task's metadata
 * endpoint, with timeouts and retries of its own. So the deadline also races
 * the whole send, and a request whose credentials come late finds the signal
 * already fired, and never goes out.
 */
export async function withDeadline<T>(
  send: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let onAbort = () => undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(
        new Error(`DynamoDB didn't answer within ${String(TIMEOUT_MS)} ms`, {
          cause: signal.reason,
        }),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([send(signal), expired]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
