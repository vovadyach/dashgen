# Costs

What holds DashGen's costs down, how to set the one limit that lives outside this repo, and how to see what questions cost.

## The limits

| Limit | Where it lives | When it's reached |
|---|---|---|
| 6 model calls, 24,000 input tokens and 25 seconds a question | The backend ([design](../design.md#the-daily-cap)) | The run ends with `agent_failed` or `timeout` |
| 10 questions a minute from one IP | The backend, in memory | `POST /api/ask` answers 429 `rate_limited` |
| 150 questions a day by default (`DAILY_CAP`), for every visitor together | The backend and DynamoDB ([ADR-0014](../decisions/0014-daily-cap-in-dynamodb.md)) | `POST /api/ask` answers 503 `daily_cap`, and Gemini isn't called |
| $20 a month | The Gemini project, in Google AI Studio | Gemini answers 429. DashGen tries once more, then shows "Gemini can't answer right now", until the next month or a higher cap |

## Set the Gemini spend cap

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

## Raise the daily cap for a launch

For the first 2 or 3 days after you share the demo, set `DAILY_CAP=300` in `backend/.env`, or in the backend's settings on AWS (step 5), and restart the backend. Set it back to 150 afterwards.

| `DAILY_CAP` | Most it can cost, at $0.011 a question |
|---|---|
| 150, the default | $1.65 a day |
| 300 | $3.30 a day, so about $10 for 3 days, within the $20 spend cap |

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
- The cost is DashGen's estimate: Gemini's token counts at the prices in `backend/src/config.ts`. Google's bill, under **Spend** in AI Studio, is the real number.
- On AWS, every deploy starts the `runs` table over ([roadmap](../roadmap.md), step 5), so the report covers one session.

AWS's own costs, with budget alerts at $10, $25 and $50, come with step 5.
