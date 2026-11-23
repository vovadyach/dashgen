#!/usr/bin/env bash
# Builds the page for AWS, with the site key of DashGen's Turnstile widget in
# VITE_TURNSTILE_SITE_KEY (ADR-0021). CI's deploy-page job and the runbook's
# deploy by hand both build with it, so both stop on the same keys: none, as
# when `gh variable get` fails, one of Cloudflare's test keys, a key longer
# than a site key can be, like the widget's secret key, or one with a space
# or line break in it. The page would get no token, or a test one, which the
# backend's real secret turns down, so every question on AWS would get
# bot_check_failed. A secret key in the page would also be public.
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
# Cloudflare's API gives a site key at most 32 characters, and no set prefix
# (https://developers.cloudflare.com/api/resources/turnstile/subresources/widgets/methods/create/).
# The widget's secret key is longer, so a longer key is never a site key,
# and may be that secret: the message gives only its length.
if ((${#key} > 32)); then
  fail "VITE_TURNSTILE_SITE_KEY has ${#key} characters, so it isn't a site key, which has at most 32. If it's the widget's secret key, which is longer, rotate that in Cloudflare too, since CI's log shows the job's variables: docs/runbooks/deploy.md#the-turnstile-widget"
fi
# As from a paste: no key has one.
if [[ $key =~ [[:space:]] ]]; then
  fail "VITE_TURNSTILE_SITE_KEY has a space or a line break in it, as from a paste. Set it to the site key alone: docs/runbooks/deploy.md#the-page"
fi
npm run build --workspace frontend
