#!/usr/bin/env bash
# make aws-open: opens the API's door (ADR-0003). It writes the session entry,
# with this session's load balancer and secret, into CloudFront's key-value
# store, so CloudFront sends /api/* to the backend instead of answering
# offline. Then it waits until CloudFront itself answers ok for the backend.
# make aws-up runs it once the backend is healthy.
#
# It refuses while make aws-down holds this stack's closing entry, since the
# stack may be on its way out. A canceled teardown leaves that entry, and
# FORCE_OPEN=1 make aws-open reopens the door then.
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/aws-session.sh

store=$(always_on_output session_store_arn)
url=$(always_on_output url)
load_balancer=$(output load_balancer)

version=$(store_version)
entry=$(read_entry)
if [[ ${FORCE_OPEN:-} != 1 ]] && closing_for "$entry" "$load_balancer"; then
  echo "make aws-down is closing this stack's door, or was canceled, so it stays closed." >&2
  echo "If no teardown is running: FORCE_OPEN=1 make aws-open" >&2
  exit 1
fi

open=$(session_entry)
if ! put_entry "$version" "$open"; then
  echo "CloudFront's store changed while the door was opening, maybe from another terminal: run make aws-open again." >&2
  exit 1
fi

echo "Opened the API's door. Each of CloudFront's servers sees it on its own, within about half a minute."
# Every 2 seconds, for up to 2 minutes, however long each check takes.
deadline=$((SECONDS + 120))
while ((SECONDS < deadline)); do
  if curl --silent --max-time 5 "$url/api/health" | grep -q '"status":"ok"'; then
    echo "DashGen is live at $url"
    exit 0
  fi
  sleep 2
done

echo "CloudFront still doesn't answer ok after 2 minutes: see $url/api/health, and docs/runbooks/deploy.md#the-apis-door." >&2
exit 1
