import { z } from "zod";

/**
 * What Cloudflare's siteverify answers about a Turnstile token: whether it
 * passed, and why not. Only the fields DashGen reads.
 */
export const Verdict = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).default([]),
});
export type Verdict = z.infer<typeof Verdict>;
