import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath, URL } from "node:url";

import { planChanges } from "./plan-changes.js";

// Plans as `terraform show -json` writes them, with only the fields that
// planChanges reads. Real plans can't be fixtures here: they hold the
// account ID, in the bucket's name.
const plan = (...resources) => ({
  format_version: "1.2",
  resource_changes: resources,
});
const change = (address, actions, more = {}) => {
  const { reason, forced } = more;
  return {
    address,
    action_reason: reason,
    change: { actions, replace_paths: forced },
  };
};

describe("planChanges", () => {
  it("lists only the summary when nothing is deleted", () => {
    const lines = planChanges(
      plan(
        change("aws_vpc.main", ["create"]),
        change("aws_s3_bucket.site", ["update"]),
        change("aws_iam_role.page_deploy", ["no-op"]),
        change("data.aws_region.current", ["read"]),
      ),
    );
    assert.deepEqual(lines, ["Plan: 1 to add, 1 to change, 0 to destroy."]);
  });

  it("names every replacement, whatever set it off, with the attributes that force it", () => {
    const lines = planChanges(
      plan(
        change("aws_cloudfront_key_value_store.session", ["delete", "create"], {
          reason: "replace_because_cannot_update",
          forced: [["name"]],
        }),
        // Created first, then the old one deleted: create_before_destroy.
        change("aws_security_group.lb", ["create", "delete"], {
          reason: "replace_because_cannot_update",
          forced: [["ingress", 0, "cidr_blocks"], ["name"]],
        }),
        // Terraform's text says "will be replaced, as requested" for this one,
        // and "will be replaced due to changes in replace_triggered_by" for
        // the next: words a search for "must be replaced" misses.
        change("aws_cloudfront_function.api", ["delete", "create"], {
          reason: "replace_by_request",
        }),
        change("aws_ecs_service.backend", ["delete", "create"], {
          reason: "replace_by_triggers",
        }),
        change("aws_db_instance.main", ["delete", "create"], {
          reason: "replace_because_tainted",
        }),
      ),
    );
    assert.deepEqual(lines, [
      "REPLACE  aws_cloudfront_key_value_store.session  replace_because_cannot_update  name",
      "REPLACE  aws_security_group.lb  replace_because_cannot_update  ingress.0.cidr_blocks, name",
      "REPLACE  aws_cloudfront_function.api  replace_by_request",
      "REPLACE  aws_ecs_service.backend  replace_by_triggers",
      "REPLACE  aws_db_instance.main  replace_because_tainted",
      "Plan: 5 to add, 0 to change, 5 to destroy.",
    ]);
  });

  it("names every deletion, with Terraform's reason when it gives one", () => {
    const lines = planChanges(
      plan(
        change("aws_db_instance.old", ["delete"], {
          reason: "delete_because_no_resource_config",
        }),
        // A destroy plan gives no reason.
        change("aws_iam_role_policy.page_deploy", ["delete"]),
      ),
    );
    assert.deepEqual(lines, [
      "DELETE  aws_db_instance.old  delete_because_no_resource_config",
      "DELETE  aws_iam_role_policy.page_deploy",
      "Plan: 0 to add, 0 to change, 2 to destroy.",
    ]);
  });

  it("doesn't count a resource that Terraform only forgets, which stays in AWS", () => {
    const lines = planChanges(plan(change("aws_s3_bucket.old", ["forget"])));
    assert.deepEqual(lines, ["Plan: 0 to add, 0 to change, 0 to destroy."]);
  });

  it("reads a plan with no resource changes at all", () => {
    assert.deepEqual(planChanges({ format_version: "1.2" }), [
      "Plan: 0 to add, 0 to change, 0 to destroy.",
    ]);
  });
});

describe("node scripts/plan-changes.js", () => {
  it("reads the plan's JSON on stdin, and prints a line each", () => {
    const script = fileURLToPath(new URL("plan-changes.js", import.meta.url));
    const output = execFileSync(process.execPath, [script], {
      input: JSON.stringify(
        plan(
          change("aws_cloudfront_function.api", ["delete", "create"], {
            reason: "replace_by_request",
          }),
        ),
      ),
      encoding: "utf8",
    });
    assert.equal(
      output,
      "REPLACE  aws_cloudfront_function.api  replace_by_request\nPlan: 1 to add, 0 to change, 1 to destroy.\n",
    );
  });
});
