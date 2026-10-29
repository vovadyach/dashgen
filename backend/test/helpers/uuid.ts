import assert from "node:assert/strict";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Checks that `id` is a UUIDv7 made in the last minute, from the time in its first 48 bits. */
export function assertRecentUuidV7(id: unknown): void {
  assert.ok(typeof id === "string", `expected a string, got ${typeof id}`);
  assert.match(id, UUID_V7);
  const ms = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
  assert.ok(
    Math.abs(Date.now() - ms) < 60_000,
    `${id} carries ${new Date(ms).toISOString()}, not about now`,
  );
}
