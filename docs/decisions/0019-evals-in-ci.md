# 19. The evals also run in CI, on pull requests that change the agent

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

[ADR-0018](0018-agent-evals.md) left the evals to people, since each run spends the Claude credits. So a change that hurt the agent showed only if someone remembered to run them. A run of all 54 costs about $0.05 and takes a minute, and the Max plan gives $100 of credits a month. The options were:

- **When:** on every pull request, only on those that change the agent, or never.
- **What fails the check:** any wrong run, a case wrong in both its runs, or nothing, with the score only.
- **The key:** the Claude key as a GitHub secret, or no runs in CI at all.

## Decision

- **A workflow of its own, `.github/workflows/evals.yml`, runs `npm run eval` on pull requests that change what decides an answer or its grade:** the files that the eval's fingerprint covers, `package-lock.json`, since a package upgrade can change what the model gets, and the workflow itself. A pull request that changes only the page or the docs spends nothing.
- **It fails when a case is wrong in both its runs,** or when a run is left unscored, as with an expired key. A case wrong once passes, since one wrong run can be chance: between 2 runs of the same agent, c13 was wrong once.
- **The key is a GitHub secret, `ANTHROPIC_API_KEY`: a key of its own, used only by CI.** Pull requests from forks get no secrets, so the job skips them, and only the repo's own branches spend the credits. The eval's log shows only each error's message, never its response headers, which name the Claude organization: the log is public.
- **The score goes on the run's page.** The traces stay on the runner: to read them, run the eval locally.

## Consequences

- A change that breaks a case shows on its pull request, before the merge, for about $0.05 a push. A newer push cancels the run that's still going.
- CI's key lives in GitHub, apart from the local one, so a leak from CI means replacing only that key. When it expires, the check fails until the secret is updated.
- It can't be a required check: GitHub would wait forever for it on pull requests that don't run it.
- A case that's wrong once on every pull request still passes. Only reading the score shows it.
