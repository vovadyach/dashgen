// PostToolUse hook: formats each file Claude writes or edits.
//
// TypeScript, JavaScript, JSON, CSS and HTML files in the backend, the
// frontend, the shared packages, these hooks and the repo root get Prettier,
// and other files are left alone. It never blocks Claude: scripts/check.sh
// catches anything this misses.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PRETTIER = path.join(ROOT, "node_modules", ".bin", "prettier");
const PRETTIER_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".json",
  ".css",
  ".html",
]);
const PRETTIER_FOLDERS = [
  path.join(ROOT, "backend"),
  path.join(ROOT, "frontend"),
  path.join(ROOT, "packages"),
  import.meta.dirname,
];

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
    path.dirname(file) === ROOT ||
    PRETTIER_FOLDERS.some((folder) => isInside(folder, file));

  // Prettier is installed by `make install`; until then, skip. Running from
  // the root applies its .prettierignore, which skips package-lock.json.
  if (
    PRETTIER_EXTENSIONS.has(extension) &&
    formatsWithPrettier &&
    existsSync(PRETTIER)
  ) {
    spawnSync(PRETTIER, ["--write", "--log-level", "warn", file], {
      cwd: ROOT,
    });
  }
}
