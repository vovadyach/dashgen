// Reads a Terraform plan as JSON on stdin (terraform show -json <plan>), and
// prints only what it would delete or replace, then a summary, counted the
// way Terraform's own summary line counts:
//
//   REPLACE  aws_cloudfront_key_value_store.session  replace_because_cannot_update  name
//   Plan: 1 to add, 1 to change, 1 to destroy.
//
// It reads the plan's actions, not its text, which names a replacement in
// several ways: one forced by a change, one asked for with -replace, one set
// off by replace_triggered_by, or a tainted resource's. Imports and forgets
// delete nothing, so they aren't counted. The terraform-reviewer subagent
// runs it (.claude/agents/terraform-reviewer.md), and so can anyone:
//
//   terraform -chdir=infra/aws/<stack> show -json tfplan | node scripts/plan-changes.js
import process from "node:process";

/**
 * A line per resource the plan would delete or replace, then the summary.
 * @param {{ resource_changes?: { address: string, action_reason?: string, change: { actions: string[], replace_paths?: (string | number)[][] } }[] }} plan
 * @returns {string[]}
 */
export function planChanges(plan) {
  const lines = [];
  const count = { add: 0, change: 0, destroy: 0 };
  for (const resource of plan.resource_changes ?? []) {
    const { actions } = resource.change;
    if (actions.includes("create")) count.add += 1;
    if (actions.includes("update")) count.change += 1;
    if (!actions.includes("delete")) continue;
    count.destroy += 1;
    // The attributes whose change forces a replacement, like name.
    const forced = (resource.change.replace_paths ?? [])
      .map((path) => path.join("."))
      .join(", ");
    const kind = actions.includes("create") ? "REPLACE" : "DELETE";
    const line = [kind, resource.address, resource.action_reason, forced];
    lines.push(line.filter(Boolean).join("  "));
  }
  lines.push(
    `Plan: ${String(count.add)} to add, ${String(count.change)} to change, ${String(count.destroy)} to destroy.`,
  );
  return lines;
}

// Run as a command: the plan's JSON on stdin, the lines on stdout.
if (import.meta.main) {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  for (const line of planChanges(JSON.parse(text))) {
    process.stdout.write(`${line}\n`);
  }
}
