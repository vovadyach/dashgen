# 16. One AI_MODEL setting, for Gemini or Claude Haiku 5.5

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

DashGen ran only on Gemini, and `GEMINI_MODEL` chose between two Flash-Lite models. Two things made a second provider worth having:

- The $100 Claude Max plan now includes $100 of Claude API credits a month, for API keys from one Console organization linked to the plan. With no card or other credits in that organization, requests stop when the month's credits are used, so they can't turn into a bill, unless the organization is invoiced through Anthropic's sales team.
- Gemini's free tier lets Google use the questions and answers to improve its products. Paying for Gemini avoids that, at about $0.004 a question ([design](../design.md#gemini-per-question)).

The agent loop already talks to the model through one interface (`Model`, in `backend/src/agent/types.ts`), so a second provider is a second adapter.

The options for the setting:

- **One `AI_MODEL`, from a fixed list.** Each model in the list has its provider, its prices and its key's variable.
- **`AI_PROVIDER` and a model name.** Two settings that can disagree, like `gemini` with a Claude model.
- **Any model name.** A model with no known price would leave runs without a cost, and the daily cap's ceiling unknown.

The options for the Claude model, at the design's 8,000 input and 1,500 output tokens a question:

- **Claude Haiku 5.5:** $0.10 / $0.50 per million tokens, about $0.0016 a question. It accepts a forced tool call, which the Gemini adapter already relies on, and a forced call skips thinking.
- **Claude Sonnet 5.5 or Opus 5.5:** about $0.031 and $0.062 a question, so 150 questions a day would cost $140 or $280 a month. Neither accepts a forced tool call, so the instructions would have to ask for one, and their refusal fallbacks would need handling.

## Decision

- `AI_MODEL` picks the model: `gemini-3.1-flash-lite`, the default, `gemini-3.5-flash-lite` or `claude-haiku-5-5`. It replaces `GEMINI_MODEL`, and a leftover `GEMINI_MODEL` stops the backend at startup, so it's never ignored without a word.
- Only the chosen model's key is required: `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`.
- `backend/src/agent/claude.ts` is the Claude adapter, on `@anthropic-ai/sdk`, built like `gemini.ts`: a forced tool call, 512 output tokens, low effort, no retries of the SDK's own, and the API's address and the key pinned, so no `ANTHROPIC_*` variable can change them. Its tools aren't strict: strict tools refuse the minimum, maximum and length limits that DashGen's arguments have, and each tool checks its arguments itself anyway.
- On AWS, `TF_VAR_ai_model` sets `AI_MODEL`. Terraform validates the name before creating resources. Each session stores one model key in Secrets Manager so the backend receives only the key it needs, even when both providers' keys are set in the shell. Keeping that provider for the session lets ECS read the same secret if it rolls back to the previous task definition.

## Consequences

- Locally, change `AI_MODEL` in `backend/.env` and restart the backend. On AWS, the two Gemini models share a key and can switch during a session. Switching between Gemini and Claude takes a new session. Each run saves its model and its cost, so `npm run cost` stays right across a switch. [Deploy runbook](../runbooks/deploy.md#the-session-stack)
- On Claude Haiku 5.5, a question costs less than half of what it costs on Flash-Lite, and nothing beyond the Max plan while the credits last. The most a question can cost drops from about $0.011 to $0.004 ([the daily cap](../design.md#the-daily-cap)).
- Two adapters to keep up to date, each with its own errors and quirks, and a new dependency.
- The model names are in two places, `MODELS` and the session stack's `model_providers`, so a new model goes in both. A test fails when they differ.
- Claude Haiku 5.5 has no server-side fallback for refusals: a refused question ends as a decline, like a question Gemini's safety filter blocks.
- The credits last only while the Max plan does, and the organization linked to the plan can't be changed without Anthropic's support.
- Whether Claude Haiku 5.5 answers as well as Flash-Lite is for step 6's evals to measure, and `AI_MODEL` lets them run on both.
