// Stop hook: runs scripts/check.sh when Claude finishes a turn that changed files.
//
// It also runs on UserPromptSubmit, where it saves a fingerprint of the repo's
// files. If the fingerprint is the same at Stop, the turn changed nothing (a
// question or a review), so the checks are skipped and Claude is never sent to
// fix changes it didn't make.
//
// When a check fails, Claude is sent back with the output to fix it. After
// MAX_RETRIES returns in one turn Claude may stop anyway and the user is told,
// so a failure Claude can't fix doesn't loop forever.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MAX_RETRIES = 2;
const OUTPUT_LINES = 60;

interface HookEvent {
  session_id?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
}

function hasChanges(): boolean {
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return status.stdout.trim() !== "";
}

/** Hashes every file git sees: tracked, or untracked and not ignored. */
function fingerprint(): string {
  const listing = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (listing.status !== 0) {
    throw new Error(`git ls-files failed: ${listing.stderr}`);
  }
  const digest = createHash("sha256");
  for (const name of listing.stdout.split("\0").filter(Boolean)) {
    const file = path.join(ROOT, name);
    const content =
      existsSync(file) && statSync(file).isFile()
        ? readFileSync(file)
        : Buffer.alloc(0);
    digest.update(`${name}\0`);
    digest.update(createHash("sha256").update(content).digest());
  }
  return digest.digest("hex");
}

function main(): void {
  const event = JSON.parse(readFileSync(0, "utf8")) as HookEvent;
  const session = event.session_id ?? "unknown";
  const baselineFile = path.join(tmpdir(), `dashgen-baseline-${session}`);
  const retriesFile = path.join(tmpdir(), `dashgen-stop-${session}`);

  if (event.hook_event_name === "UserPromptSubmit") {
    writeFileSync(baselineFile, fingerprint());
    return;
  }

  if (!hasChanges()) {
    return;
  }
  // Without a baseline (the hook was added mid-session, say), assume files changed.
  if (
    existsSync(baselineFile) &&
    readFileSync(baselineFile, "utf8") === fingerprint()
  ) {
    return;
  }

  // stop_hook_active is true only while Claude is still working because this
  // hook sent it back, so retries are counted per turn.
  let retries = 0;
  if (event.stop_hook_active === true && existsSync(retriesFile)) {
    retries = Number(readFileSync(retriesFile, "utf8"));
  }

  // The shell sends stderr into stdout, so the output keeps its order.
  const check = spawnSync(
    "/bin/sh",
    ["-c", 'exec "$0" 2>&1', path.join(ROOT, "scripts", "check.sh")],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (check.status === 0) {
    rmSync(retriesFile, { force: true });
    return;
  }

  if (retries >= MAX_RETRIES) {
    rmSync(retriesFile, { force: true });
    const message = `scripts/check.sh still fails after ${String(MAX_RETRIES)} retries.`;
    console.log(JSON.stringify({ systemMessage: message }));
    return;
  }

  writeFileSync(retriesFile, String(retries + 1));
  const output = check.stdout
    .trimEnd()
    .split("\n")
    .slice(-OUTPUT_LINES)
    .join("\n");
  const reason =
    "scripts/check.sh failed. Fix it before finishing. If a failure comes " +
    "from changes you didn't make this turn, tell the user instead of " +
    `fixing it.\n\n${output}`;
  console.log(JSON.stringify({ decision: "block", reason }));
}

main();
