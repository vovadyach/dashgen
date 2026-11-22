import assert from "node:assert/strict";

import { CASES, type EvalCase } from "../../evals/cases.ts";

/** The eval case whose id starts with ID, like "c01". */
export function findCase(id: string): EvalCase {
  const found = CASES.find((c) => c.id.startsWith(`${id}-`));
  assert.ok(found, `no case ${id}`);
  return found;
}
