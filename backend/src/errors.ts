import type { ApiErrorCode, ErrorBody } from "@dashgen/contracts";

// Shared with the page, which shows the same words for a bug it finds itself.
export { INTERNAL_ERROR } from "@dashgen/contracts";

export function errorBody(code: ApiErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Thrown anywhere in a request, it becomes an error response with this status, code and message. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
