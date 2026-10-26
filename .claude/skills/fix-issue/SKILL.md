---
name: fix-issue
description: Work a GitHub issue through to passing checks, then stop for the user's review. Use when the user runs /fix-issue <number> or asks to fix a specific issue.
argument-hint: <issue-number>
disable-model-invocation: true
---

Fix GitHub issue #$ARGUMENTS.

1. Read it: `gh issue view $ARGUMENTS --json title,body,comments`. (Outside a terminal, `--comments` alone prints only the comments, not the issue.) If no number was given, run `gh issue list` and ask which issue. If it's unclear what "done" means, ask before writing code.
2. Find the code involved. Say in a few lines what you'll change and why, then go ahead.
3. Write a test that fails because of the issue, then make it pass. Follow the `CLAUDE.md` of the service you touch.
4. Run `scripts/check.sh` until it passes.
5. If you made a choice someone could question, offer to record it with `/adr`.
6. Stop and report: what changed, file by file; why; how you tested it; and anything left open. Suggest a commit message that ends with `Fixes #$ARGUMENTS`.

Don't commit, push or open a PR. The user reviews and commits.
