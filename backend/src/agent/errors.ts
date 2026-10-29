/** A tool call the model got wrong. Its message goes back to the model, so it can correct the call. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

/** The model's provider failed. `retryable` when trying again could work: a timeout, a rate limit or an outage. */
export class ModelError extends Error {
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(
    message: string,
    options: { retryable: boolean; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "ModelError";
    this.retryable = options.retryable;
    this.status = options.status;
  }
}
