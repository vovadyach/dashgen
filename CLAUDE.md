@AGENTS.md

## Claude Code only

- `.claude/hooks/`: the format hook formats each TypeScript file you edit, and the stop hook runs `make check` when you finish a turn that changed files. They're TypeScript that Node runs directly, and `make check` checks them too.
- `/adr` writes a new ADR, and `/fix-issue <number>` works a GitHub issue through to passing checks (`.claude/skills/`).
