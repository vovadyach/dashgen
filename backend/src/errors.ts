import type { ErrorBody } from "@dashgen/contracts";

/** A bug in DashGen, as visitors see it: in a 500, or as a run's last event. */
export const INTERNAL_ERROR = {
  code: "internal_error",
  message: "Something went wrong.",
} as const;

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Thrown anywhere in a request, it becomes an error response with this status, code and message. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
