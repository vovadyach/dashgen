# Costs

What holds DashGen's costs down, how to set the limits that live outside this repo, and how to see what questions cost.

## The limits

| Limit | Where it lives | When it's reached |
|---|---|---|
| 6 model calls, 24,000 input tokens and 25 seconds a question | The backend ([design](../design.md#the-daily-cap)) | The run ends with `agent_failed` or `timeout` |
| 10 questions a minute from one IP | The backend, in memory | `POST /api/ask` answers 429 `rate_limited` |
| 150 questions a day by default (`DAILY_CAP`), for every visitor together | The backend and DynamoDB ([ADR-0014](../decisions/0014-daily-cap-in-dynamodb.md)) | `POST /api/ask` answers 503 `daily_cap`, and the model isn't called |
| $20 a month, on a Gemini model | The Gemini project, in Google AI Studio | Gemini answers 429. DashGen tries once more, then shows "The AI model can't answer right now", until the next month or a higher cap |
| $100 a month, on `claude-haiku-5-5` | The Claude Max plan's API credits ([below](#use-claude-on-the-max-plans-credits)) | Claude refuses the requests, and DashGen shows "The AI model can't answer right now", until the next month's credits |

## Set the Gemini spend cap

Only a project with billing needs it. On the free tier, with no billing account, Gemini can't charge at all, and DashGen's own project stays there, since DashGen runs on Claude's credits.

Do it once, by hand: the cap is in your Google account, not in this repo.

1. Open [Google AI Studio](https://aistudio.google.com), in the project that holds DashGen's API key.
2. Open **Spend**, then **Edit spend cap** under **Monthly spend cap**.
3. Enter **20** dollars, and save.

- On the Free tier, Google bills nothing, so there's nothing to cap yet. Set the cap when you link a billing account, which moves the project to Tier 1.
- Each tier also has Google's own monthly cap for the billing account: $250 at Tier 1. It's far above $20, so the project's cap stops spending first.
- It needs the project's editor, owner or admin role.
- Google's billing data runs about 10 minutes behind. The daily cap limits what gets past the spend cap in that time to two days' questions at most, when those minutes span midnight UTC: $3.30 at the default 150, or $6.60 at 300.
- The cap stays on until you change it. Invoiced billing accounts can't set one.

Google's [billing docs](https://ai.google.dev/gemini-api/docs/billing) have the details.

## Use Claude on the Max plan's credits

The $100 Claude Max plan includes $100 of Claude API credits a month, for API keys from one Claude Console organization linked to the plan ([ADR-0016](../decisions/0016-ai-model-setting.md)). Link it once, by hand:

1. On [claude.ai](https://claude.ai), as the plan's subscriber, open **Settings**, then **Billing**.
2. Under **API credits**, select **Link organization**, choose a Console organization or create one, review the terms, and link it.
3. In that organization, on [platform.claude.com](https://platform.claude.com), create an API key.
4. Put it in `backend/.env` as `ANTHROPIC_API_KEY`, with `AI_MODEL=claude-haiku-5-5`, then run `npm run model:check`. On AWS, the key and the model come from `TF_VAR_anthropic_api_key` and `TF_VAR_ai_model` ([deploy runbook](deploy.md#the-session-stack)).
5. For the evals in CI, add it to GitHub too: run `gh secret set ANTHROPIC_API_KEY` and paste it ([ADR-0019](../decisions/0019-evals-in-ci.md)).

- Add no card and buy no credits in that organization. Then, once the month's $100 is used, requests stop until the next month's credits, instead of being billed. Usage is never charged to the Claude plan itself. This doesn't hold for an organization invoiced through Anthropic's sales team, which is billed as usual beyond the credits.
- Unused credits expire at the end of each billing cycle. A new subscriber can link an organization after 7 days on the plan.
- Only one organization can be linked, and only Anthropic's support can change which. You need its Owner, Admin or Billing role.
- The credits don't change Claude Code's limits, and Claude Code doesn't use them.
- On `claude-haiku-5-5`, a question costs at most about $0.004, so 150 questions a day use at most about $18 a month.
- CI's evals use about $0.05 a run, on each push to a pull request that changes the agent.
- A key with an expiry date needs a new one before then, in the same 3 places: `backend/.env`, `TF_VAR_anthropic_api_key` at the next `make aws-up`, and the GitHub secret. Then delete the old key. A session that's already up keeps the old key until `make aws-down`.

Anthropic's [help article](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans) has the details.

## Raise the daily cap for a launch

For the first 2 or 3 days after you share the demo, set `DAILY_CAP=300` in `backend/.env`, or in the backend's settings on AWS (step 5), and restart the backend. Set it back to 150 afterwards.

| `DAILY_CAP` | Most it can cost, at $0.011 a question |
|---|---|
| 150, the default | $1.65 a day |
| 300 | $3.30 a day, so about $10 for 3 days, within the $20 spend cap |

On `claude-haiku-5-5`, at most about $0.004 a question, 300 questions a day cost at most about $1.20, well within the month's credits.

The day's count stays as it is: with 150 used, raising the cap to 300 lets 150 more questions through that day.

## See what questions cost

`npm run cost` reads the `runs` table: each UTC day's questions, what they cost, and the cost per question.

```
Day (UTC)    Questions      Cost   Per question
2026-11-02           2   $0.0148        $0.0074
2026-11-01           3   $0.0127        $0.0042
Total                5   $0.0275        $0.0055
```

- Only questions that reached the agent count. Ones turned away first, like an invalid one or one over the daily cap, cost nothing, and aren't runs.
- The cost is DashGen's estimate: the provider's token counts at the prices in `backend/src/config.ts`. The real numbers are Google's bill, under **Spend** in AI Studio, and Claude's usage, in the Console.
- On AWS, every session starts the `runs` table over ([roadmap](../roadmap.md), step 5), so the report covers one session.

AWS's own costs have budget alerts at $10, $25 and $50 ([AWS account runbook](aws-account.md#4-budget-alerts)).
