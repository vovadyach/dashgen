import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

/** How long a request to DynamoDB may take, to the last byte of its reply. */
const TIMEOUT_MS = 2_000;

/**
 * A client for DynamoDB Local at `endpoint`. Its keys are fake: DynamoDB Local
 * takes any, and fake ones can't reach a real AWS account, even on a machine
 * that has real keys. AWS's own DynamoDB comes in step 5, with the task's
 * role. Close it with `client.destroy()`.
 */
export function createDynamo(endpoint: string): DynamoDBClient {
  return new DynamoDBClient({
    endpoint,
    region: "local",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
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
  });
}

/**
 * Ends a request after 2 seconds, however far its reply has come. Pass it to
 * every send, as `{ abortSignal: requestDeadline() }`: the client's own
 * requestTimeout stops once the reply's headers arrive, so a body that stalls
 * after them would keep a question waiting.
 */
export const requestDeadline = () => AbortSignal.timeout(TIMEOUT_MS);
