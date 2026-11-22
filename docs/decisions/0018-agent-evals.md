# 18. The agent's evals are graded by code, on fixed data, and only people run them

- **Status:** Accepted. [ADR-0019](0019-evals-in-ci.md) adds runs in CI, on pull requests that change the agent
- **Date:** 2026-11-21

## Context

Roadmap step 6 asks for evals: questions with their right answers, run on the real model, and scored. `make check` tests the code on a fake model, so it can't see the model's own choices. A cap of 512 output tokens cut off Claude's replies on AWS, and only asking questions there showed it. Each eval run calls the model, billed to the user's Claude credits. The options were:

- **Grading:** by code, or by a second model, as a judge.
- **Data:** the real agent loop and tools on a seeded database, or tools that return canned results.
- **Who runs it:** people, or CI on every pull request.
- **The runner:** the Claude API skill's JavaScript scaffold, or one in the repo's TypeScript.

## Decision

- **Code grades every answer.** The agent's answers are structured: an outcome, and a chart's type, services and numbers. The grader builds each right chart from the sample data with DashGen's own chart code, and compares it with the agent's, everything but the title. A case can list other answers that are just as right, like totals for "compare services".
- **The real agent loop, model adapter and tools run on sample data seeded at a fixed time,** 2026-11-18 15:30 UTC, in a fresh database on the test Postgres. The seed is deterministic, so the right answers never change.
- **Only people run it,** with `npm run eval`: 27 cases, twice each, for about $0.05 and a minute. The results and traces stay on their machine, in `.claude/hillclimb/agent/`, in the report format of the Claude API skill's eval guide.
- **The runner is TypeScript, in `backend/evals/`,** so ESLint and the type checker cover it. Its own tests, and the grader's, run on the fake model in `make check`, for free.

## Consequences

- Grading is free and instant, and never disagrees with itself. A judge would cost money, and could be wrong.
- The first baseline, on Claude Haiku 5.5, is 46 of 54 runs right (85%). It found 4 real mistakes, like showing only errors for "How is checkout-api doing?", which hides that service's latency spike.
- 27 cases run twice can move by about 13 points by chance, since a case's 2 runs mostly agree, so the eval catches big breaks, not small gains. Only more cases narrow that, since each case counts once.
- Nothing runs it by itself: a change that hurts the agent shows only when someone runs it. Running it in CI would spend the credits on every pull request, which is a later decision.
- Each new case needs its right answer written by hand, and a decision whenever the model's different answer is just as right.
- "This week" is always the week before 2026-11-18, since the clock is fixed.
