// PostToolUse hook: formats each file Claude writes or edits.
//
// TypeScript, JavaScript and JSON files in the gateway and in these hooks get
// Prettier, Go files get gofmt, and other files are left alone. It never blocks
// Claude: scripts/check.sh catches anything this misses.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const GATEWAY = path.join(ROOT, "gateway");
const PRETTIER = path.join(GATEWAY, "node_modules", ".bin", "prettier");
const PRETTIER_EXTENSIONS = new Set([".ts", ".js", ".json"]);

interface HookEvent {
  tool_input?: { file_path?: string };
}

function isInside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return relative !== "" && !relative.startsWith("..");
}

const event = JSON.parse(readFileSync(0, "utf8")) as HookEvent;
const file = path.resolve(event.tool_input?.file_path ?? "");

if (isInside(ROOT, file) && existsSync(file) && statSync(file).isFile()) {
  const extension = path.extname(file);
  const formatsWithPrettier =
    isInside(GATEWAY, file) || isInside(import.meta.dirname, file);

  if (PRETTIER_EXTENSIONS.has(extension) && formatsWithPrettier) {
    // Prettier is installed by `make install`; until then, skip.
    if (existsSync(PRETTIER)) {
      spawnSync(PRETTIER, ["--write", "--log-level", "warn", file], {
        cwd: GATEWAY,
      });
    }
  } else if (extension === ".go") {
    spawnSync("gofmt", ["-w", file]);
  }
}
