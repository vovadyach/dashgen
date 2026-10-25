# /// script
# requires-python = ">=3.14"
# ///
"""Stop hook: runs scripts/check.sh when Claude finishes a turn that changed files.

It also runs on UserPromptSubmit, where it saves a fingerprint of the repo's
files. If the fingerprint is the same at Stop, the turn changed nothing (a
question or a review), so the checks are skipped and Claude is never sent to
fix changes it didn't make.

When a check fails, Claude is sent back with the output to fix it. After
MAX_RETRIES returns in one turn Claude may stop anyway and the user is told,
so a failure Claude can't fix doesn't loop forever.
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAX_RETRIES = 2
OUTPUT_LINES = 60


def has_changes() -> bool:
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return bool(status.stdout.strip())


def fingerprint() -> str:
    """Hashes every file git sees: tracked, or untracked and not ignored."""
    listing = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    )
    digest = hashlib.sha256()
    for name in filter(None, listing.stdout.split(b"\0")):
        path = ROOT / os.fsdecode(name)
        content = path.read_bytes() if path.is_file() else b""
        digest.update(name + b"\0" + hashlib.sha256(content).digest())
    return digest.hexdigest()


def main() -> None:
    event = json.load(sys.stdin)
    session = event.get("session_id", "unknown")
    baseline_file = Path(tempfile.gettempdir()) / f"dashgen-baseline-{session}"
    retries_file = Path(tempfile.gettempdir()) / f"dashgen-stop-{session}"

    if event.get("hook_event_name") == "UserPromptSubmit":
        baseline_file.write_text(fingerprint())
        return

    if not has_changes():
        return
    # Without a baseline (the hook was added mid-session, say), assume files changed.
    if baseline_file.exists() and baseline_file.read_text() == fingerprint():
        return

    # stop_hook_active is true only while Claude is still working because this
    # hook sent it back, so retries are counted per turn.
    retries = 0
    if event.get("stop_hook_active") and retries_file.exists():
        retries = int(retries_file.read_text())

    check = subprocess.run(
        [ROOT / "scripts" / "check.sh"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if check.returncode == 0:
        retries_file.unlink(missing_ok=True)
        return

    if retries >= MAX_RETRIES:
        retries_file.unlink(missing_ok=True)
        message = f"scripts/check.sh still fails after {MAX_RETRIES} retries."
        print(json.dumps({"systemMessage": message}))
        return

    retries_file.write_text(str(retries + 1))
    output = "\n".join(check.stdout.splitlines()[-OUTPUT_LINES:])
    reason = (
        "scripts/check.sh failed. Fix it before finishing. If a failure comes "
        "from changes you didn't make this turn, tell the user instead of "
        f"fixing it.\n\n{output}"
    )
    print(json.dumps({"decision": "block", "reason": reason}))


if __name__ == "__main__":
    main()
