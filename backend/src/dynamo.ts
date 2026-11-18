import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import { z } from "zod";

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
    // withDeadline(). Without throwOnRequestTimeout, the SDK would only log a
    // warning, and keep waiting.
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

/** The credentials of an ECS task's role, which sign its requests to AWS. */
export interface TaskCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

/** What ECS's credential endpoint answers. */
const EcsCredentialReply = z.object({
  AccessKeyId: z.string().min(1),
  SecretAccessKey: z.string().min(1),
  Token: z.string().min(1),
  Expiration: z.iso.datetime({ offset: true }),
});

/** Credentials are fetched again this long before they expire. */
const REFRESH_EARLY_MS = 5 * 60_000;

export interface EcsCredentialOptions {
  /** Where ECS answers. Tests pass a fake. */
  origin?: string;
  env?: NodeJS.ProcessEnv;
  /** How long one lookup may take, to the last byte of its reply. */
  timeoutMs?: number;
  now?: () => Date;
}

/**
 * The ECS task's credentials, from the address ECS gives the task in
 * AWS_CONTAINER_CREDENTIALS_RELATIVE_URI. The SDK can look them up by itself,
 * but it has no deadline for a reply that stalls after its headers, and it
 * makes every later request wait on that same lookup: each question would get
 * a 503 until the task restarted, while /api/health still passed. So the
 * backend asks ECS itself, within 1 second for the whole reply, and after a
 * failure, asks again at the next request. The credentials are kept until 5
 * minutes before they expire. Outside an ECS task there's nothing to ask, so
 * it fails, instead of signing with a developer's own credentials.
 */
export function ecsCredentials({
  origin = "http://169.254.170.2",
  env = process.env,
  timeoutMs = 1_000,
  now = () => new Date(),
}: EcsCredentialOptions = {}): () => Promise<TaskCredentials> {
  let current: TaskCredentials | undefined;
  let pending: Promise<TaskCredentials> | undefined;

  async function lookUp(): Promise<TaskCredentials> {
    const path = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    if (path === undefined || path === "") {
      throw new Error(
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI isn't set: AWS's own DynamoDB works only in an ECS task with a role.",
      );
    }
    // The signal ends the whole reply, its body too.
    const response = await fetch(new URL(path, origin), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `ECS's credential endpoint answered ${String(response.status)}.`,
      );
    }
    const reply = EcsCredentialReply.parse(await response.json());
    return {
      accessKeyId: reply.AccessKeyId,
      secretAccessKey: reply.SecretAccessKey,
      sessionToken: reply.Token,
      expiration: new Date(reply.Expiration),
    };
  }

  return async () => {
    if (
      current &&
      current.expiration.getTime() - now().getTime() > REFRESH_EARLY_MS
    ) {
      return current;
    }
    // Requests at the same moment share one lookup, which always ends within
    // timeoutMs, so a failed one never holds up the next request.
    pending ??= lookUp().finally(() => {
      pending = undefined;
    });
    current = await pending;
    return current;
  };
}

/**
 * A client for AWS's own DynamoDB in `region`, for the backend on ECS. It signs
 * with the task's role (`ecsCredentials`), and requests go through the VPC's
 * gateway endpoint (infra/aws/session). Close it with `client.destroy()`.
 */
export function createAwsDynamo(region: string): DynamoDBClient {
  return new DynamoDBClient({
    region,
    credentials: ecsCredentials(),
    ...NO_RETRY_WITH_TIMEOUTS,
  });
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
