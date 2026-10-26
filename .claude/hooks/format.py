# /// script
# requires-python = ">=3.14"
# ///
"""PostToolUse hook: formats each file Claude writes or edits.

Python files get ruff (formatting and import order), Go files get gofmt, and
other files are left alone. It never blocks Claude: scripts/check.sh catches
anything this misses.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    event = json.load(sys.stdin)
    path = Path(event.get("tool_input", {}).get("file_path", ""))
    if ROOT not in path.parents or not path.is_file():
        return

    if path.suffix == ".py":
        ruff = ["uv", "run", "--quiet", "--project", str(ROOT / "gateway"), "ruff"]
        subprocess.run([*ruff, "format", "--quiet", path], check=False)
        subprocess.run(
            [*ruff, "check", "--select", "I", "--fix", "--quiet", path], check=False
        )
    elif path.suffix == ".go":
        subprocess.run(["gofmt", "-w", path], check=False)


if __name__ == "__main__":
    main()
