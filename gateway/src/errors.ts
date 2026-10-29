import { z } from "zod";

/** Every error response: a code for programs, and a message that's safe to show visitors. */
export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ErrorBody = z.infer<typeof ErrorBody>;

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
