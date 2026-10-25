#!/usr/bin/env bash
# Runs every check in the repo: formatters, linters, type checkers and tests.
# CI runs this script too, and Claude's stop hook runs it when Claude finishes
# a turn that changed files.
set -euo pipefail

cd "$(dirname "$0")/.."

# uv uses the gateway's own .venv; an already active one (a hook's, say) only adds warnings.
unset VIRTUAL_ENV

echo "==> gateway and Claude Code hooks (Python)"
(
  cd gateway
  uv sync --locked --quiet
  # The hooks live outside gateway/, so --config gives them the gateway's ruff rules.
  uv run ruff format --check --config pyproject.toml . ../.claude/hooks
  uv run ruff check --config pyproject.toml . ../.claude/hooks
  uv run mypy src tests ../.claude/hooks
  uv run pytest --quiet
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
