@AGENTS.md

## Claude Code only

- `.claude/hooks/`: the format hook formats each TypeScript, JSON, CSS or HTML file you edit, and the stop hook runs `make check` when you finish a turn that changed files. They're TypeScript that Node runs directly, and `make check` checks them too.
- `/adr` writes a new ADR, and `/fix-issue <number>` works a GitHub issue through to passing checks (`.claude/skills/`).
- The `terraform-reviewer` subagent reads a Terraform plan and reports only what it would delete or replace (`.claude/agents/`). Use it for AGENTS.md's check before any `terraform apply`. It runs on Haiku, and never applies anything.
