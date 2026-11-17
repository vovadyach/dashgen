import { AskResponse, ErrorBody, Offline } from "@dashgen/contracts";

/** A failed request: one of the API's error codes, and a message that's safe to show. */
export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/** Starts a run that answers `question`, with `POST /api/ask`, and returns its ID. */
export async function ask(question: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
  } catch {
    throw new ApiError(
      "unreachable",
      "Can't reach DashGen. Check your connection, and try again.",
    );
  }
  const body: unknown = await response.json().catch(() => undefined);
  const started = AskResponse.safeParse(body);
  if (response.status === 202 && started.success) return started.data.runId;
  const failed = ErrorBody.safeParse(body);
  if (failed.success) {
    throw new ApiError(failed.data.error.code, failed.data.error.message);
  }
  // CloudFront's own answer between sessions (ADR-0003): no backend runs,
  // so the page switches to its offline banner.
  if (response.status === 503 && Offline.safeParse(body).success) {
    throw new ApiError("offline", "The live demo went offline.");
  }
  throw new ApiError(
    "unavailable",
    "DashGen isn't answering. Try again in a moment.",
  );
}
