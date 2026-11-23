#!/usr/bin/env bash
# Builds the page for AWS, with the site key of DashGen's Turnstile widget in
# VITE_TURNSTILE_SITE_KEY (ADR-0021). CI's deploy-page job and the runbook's
# deploy by hand both build with it, so both stop on the same keys: none, as
# when `gh variable get` fails, one of Cloudflare's test keys, or anything
# else not shaped like a site key, like the widget's secret key. The page
# would get no token, or a test one, which the backend's real secret turns
# down, so every question on AWS would get bot_check_failed. A secret key in
# the page would also be public.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  # GitHub shows it as an error on the run's page.
  echo "${GITHUB_ACTIONS:+::error::}$1"
  exit 1
}

key=${VITE_TURNSTILE_SITE_KEY:-}
if [[ -z $key ]]; then
  fail "Set VITE_TURNSTILE_SITE_KEY to the repo variable TURNSTILE_SITE_KEY: docs/runbooks/deploy.md#the-page"
fi
# Like 1x00000000000000000000BB
# (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
if [[ $key =~ ^[0-9]x0+[A-F]{2}$ ]]; then
  fail "VITE_TURNSTILE_SITE_KEY is one of Cloudflare's test keys. Use the site key of DashGen's own widget: docs/runbooks/deploy.md#the-turnstile-widget"
fi
# A site key is 0x4 and 21 more letters, digits, - or _: 24 in all. The
# widget's secret key starts the same way, with 35. The message gives only
# the length, since the key may be that secret.
if ! [[ $key =~ ^0x4[A-Za-z0-9_-]{21}$ ]]; then
  fail "VITE_TURNSTILE_SITE_KEY isn't a site key, which starts with 0x4 and has 24 characters: it has ${#key}. If it's the widget's secret key, which has 35, rotate that in Cloudflare too, since CI's log shows the job's variables: docs/runbooks/deploy.md#the-turnstile-widget"
fi
npm run build --workspace frontend
