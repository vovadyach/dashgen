// The shapes DashGen's APIs send and receive. A service validates with these
// schemas, and its clients get their types from the same place, so the two
// can't drift apart.

import { z } from "zod";

/** Every error response: a code for programs, and a message that's safe to show visitors. */
export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** The gateway's `GET /health` answer. */
export const Health = z.object({
  status: z.literal("ok"),
});
export type Health = z.infer<typeof Health>;

/** The body of the gateway's `POST /ask`. */
export const AskRequest = z.object({
  question: z.string().min(1),
});
export type AskRequest = z.infer<typeof AskRequest>;
