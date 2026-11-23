# 21. A Cloudflare Turnstile check before each question

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

Each question can cost a model call, so `POST /api/ask` already has a per-IP rate limit and a daily cap of 150 questions ([ADR-0014](0014-daily-cap-in-dynamodb.md)). The cap bounds the bill, but a bot could use up a day's questions in minutes, and real visitors would get `daily_cap` until midnight UTC. The options were:

- **The check:** none, with only the rate limit and the cap; Cloudflare Turnstile; hCaptcha; or Google's reCAPTCHA v3.
- **When Cloudflare doesn't answer:** turn the question down, or let it through.

## Decision

- **Cloudflare Turnstile, as an invisible widget.** It's free, asks visitors nothing, and needs no npm package: the page loads Cloudflare's script itself (`frontend/src/bot-check.ts`), once a check has found DashGen online: offline, nobody can ask, so a page first opened then loads nothing from Cloudflare. The widget keeps a token ready, each question takes it with it to `POST /api/ask`, and the widget makes the next, since a token works once. A question asked before a token is ready waits for one, up to 5 seconds, even one asked before that check answers.
- **The backend checks the token with Cloudflare's `siteverify` before the daily cap** (`backend/src/bots/`), so a bot takes none of today's questions. A missing or bad token gets `403 bot_check_failed`. The rate limit comes first, so a flood never reaches Cloudflare.
- **When Cloudflare is down, the question goes through,** with a warning in the log: no answer within 3 seconds, a 5xx or a 429, or its own `internal-error`. An outage there then doesn't stop the demo, and the cap still bounds the cost. Any other verdict counts, whatever its HTTP status.
- **A setup only DashGen's operator can fix gets `503 unavailable`, also before the daily cap:** a wrong secret key, which Cloudflare answers with a 400 and `invalid-input-secret`, a bad request, an answer that isn't a verdict, or a 4xx that stops partway, which turned the request down. The visitor hears of an outage, not of bots, and the log says `bot check misconfigured`, as an error. A mistyped key never switches the check off without a word.
- **Without `TURNSTILE_SECRET_KEY` there's no check,** as locally, where the page uses Cloudflare's test key. On AWS, where `DYNAMODB_REGION` is set, the backend refuses to start without it, or with one of Cloudflare's test keys, which turn every real visitor down. The secret key is in Secrets Manager, like the model's key, and `make aws-up` stops without it, or with a test key. CI's deploy, `make aws-deploy` and `make aws-start` all check the session's template first (`require_bot_check_key`): without the key, they leave the running backend alone, rather than replace it with one that won't start. The page's site key is public, so it's a repository variable, and `scripts/build-page.sh`, which CI and a deploy by hand both build the page with, stops without it, with a test key, or with a key longer than a site key's 32 characters, like the widget's secret key, which would be public in the page.

## Consequences

- A bot that gets past the rate limit no longer uses up the day's questions.
- While DashGen is online, the page loads a script from Cloudflare, and Cloudflare sees each visitor's browser, as its privacy policy describes. A page first opened between sessions loads nothing from Cloudflare. A tab opened during a session keeps its widget after the session ends, and Turnstile renews the token, which lasts 5 minutes, on its own.
- Cloudflare allows the Invisible mode only when the site's privacy text references its Turnstile Privacy Addendum, so the note under the question box links to it.
- A wrong secret key shows at the first question after `make aws-up`: it gets `unavailable`, and the backend's log says `bot check misconfigured`.
- A session made before the backend needed the key keeps its old backend until its next `make aws-up`.
- Each question waits for Cloudflare's answer, usually a few hundred milliseconds, before its run starts.
- A browser that blocks Cloudflare's script, as some ad blockers do, can't ask questions. Its visitors get `bot_check_failed`, with a message to try again or reload.
- A session costs one more secret, $0.40 a month, charged by the hour, so $0.0005 an hour.
- Setting up a new deploy takes two more steps: the widget in Cloudflare, with its secret key for `make aws-up` and its site key as a repository variable ([runbook](../runbooks/deploy.md#the-turnstile-widget)).
