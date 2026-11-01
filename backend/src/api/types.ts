import { RunEvent } from "@dashgen/contracts";
import { z } from "zod";

/** The path of `GET /api/runs/:id/events`. Any string: an unknown ID is a 404, not a bad request. */
export const RunParams = z.object({ id: z.string() });

/**
 * The events `GET /api/runs/:id/events` streams, for the docs. Typed as any
 * schema, so the route can send a stream: Fastify pipes it as it is, without
 * this schema.
 */
export const StreamedEvent: z.ZodType = RunEvent;
