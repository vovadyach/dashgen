#!/usr/bin/env bash
# Runs every check in the repo: formatters, linters, type checkers and tests.
# CI runs this script too, and Claude's stop hook runs it when Claude finishes
# a turn that changed files.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> gateway (TypeScript)"
(
  cd gateway
  # npm ci reinstalls everything, so it runs only when node_modules is missing
  # or older than the lockfile. In CI it always runs.
  if [[ ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
    npm ci --no-audit --no-fund --loglevel=error
  fi
  npm run --silent format:check
  npm run --silent lint
  npm run --silent typecheck
  npm test --silent
)

echo "==> Claude Code hooks (TypeScript)"
(
  cd .claude/hooks
  # The hooks have no packages of their own, so the gateway's tools check them.
  tools=../../gateway/node_modules/.bin
  "$tools/prettier" --check .
  "$tools/eslint" --config ../../gateway/eslint.config.js .
  "$tools/tsc" --project .
)

echo "==> metrics (Go)"
(
  cd metrics
  unformatted=$(gofmt -l .)
  if [[ -n "$unformatted" ]]; then
    echo "These files need gofmt (run: gofmt -w .):"
    echo "$unformatted"
    exit 1
  fi
  go vet ./...
  go test ./...
)

echo "All checks passed."
