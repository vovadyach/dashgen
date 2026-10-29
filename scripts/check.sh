#!/usr/bin/env bash
# Runs every check in the repo: formatters, linters, type checkers and tests.
# CI runs this script too, and Claude's stop hook runs it when Claude finishes
# a turn that changed files.
set -euo pipefail

cd "$(dirname "$0")/.."

# npm ci reinstalls every workspace, so it runs only when node_modules is
# missing or older than the lockfile. In CI it always runs.
if [[ ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  npm ci --no-audit --no-fund --loglevel=error
fi
npm run --silent format:check
npm run --silent lint
npm run --silent typecheck
# Database tests need the throwaway Postgres from compose.test.yaml.
docker compose --file compose.test.yaml up --detach --wait --quiet-pull
npm test --silent

echo "All checks passed."
