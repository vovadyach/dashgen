#!/usr/bin/env bash
# Closes the API's door before the session stack goes (ADR-0003):
#
#   scripts/aws-close.sh               closes and drains, then deletes the entry (make aws-close)
#   scripts/aws-close.sh hold <id>     closes and drains, and keeps the closing entry, marked with
#                                      the teardown's id, while terraform destroy runs (make aws-down)
#   scripts/aws-close.sh release <id>  after terraform destroy, deletes that entry, only while it
#                                      still has the same id (make aws-down)
#
# Closing marks the session entry as closing. CloudFront then answers offline
# to new questions and the health check, but the streams of runs that already
# started still reach the backend, so their answers aren't lost. Once 10
# health checks in a row answer offline, since each of CloudFront's servers
# gets the change on its own, it waits 60 seconds, longer than a run's 25 and
# CloudFront's 30-second timeout, so those runs finish.
#
# While a closing entry is there, make aws-open refuses to reopen the door, and
# a held one is left alone by a plain make aws-close too. Every write names the
# store's version that was just read, so a change from another terminal stops
# the script, as does any change during the wait, a failed read, or a check
# that fails, before anything is destroyed.
set -euo pipefail

mode=${1:-close}
teardown=${2:-}
if [[ $mode != close && -z $teardown ]]; then
  echo "Usage: scripts/aws-close.sh [hold <id> | release <id>]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
source scripts/aws-session.sh

store=$(always_on_output session_store_arn)
url=$(always_on_output url)

if [[ $mode == release ]]; then
  version=$(store_version)
  entry=$(read_entry)
  if [[ -z $entry ]]; then
    echo "The API's door is closed."
    exit 0
  fi
  held_by=$(entry_field "$entry" teardown)
  if [[ $held_by != "$teardown" ]]; then
    echo "The door's entry isn't this teardown's any more: someone reopened the door, or another make aws-down holds it. It stays as it is." >&2
    exit 1
  fi
  if ! delete_entry "$version"; then
    echo "CloudFront's store changed during the release: run make aws-close." >&2
    exit 1
  fi
  echo "The API's door is closed, and the session stack is gone."
  exit 0
fi

# With the session stack down, no backend is left to finish anything. A down
# stack has no outputs, and terraform output still succeeds, so an empty value
# means down. A failed read, as before terraform init, stops it here instead:
# the stack might be up.
stack_up=$(terraform -chdir=infra/aws/session output -raw load_balancer) || {
  echo "Can't read the session stack's state, so the door stays as it is. Run make aws-down, which runs terraform init first." >&2
  exit 1
}
version=$(store_version)
entry=$(read_entry)

if [[ -z $stack_up ]]; then
  if [[ -n $entry ]]; then
    if ! delete_entry "$version"; then
      echo "CloudFront's store changed just now: run make aws-down again." >&2
      exit 1
    fi
    echo "Deleted a session entry left from a stack that's gone."
  fi
  echo "The API's door is closed, and the session stack is down."
  exit 0
fi

held_by=$(entry_field "$entry" teardown)
if [[ $mode == close && -n $held_by ]]; then
  echo "A make aws-down holds the API's door closed while it tears the stack down, so it stays that way."
  echo "If that teardown was canceled: FORCE_OPEN=1 make aws-open reopens the door, and TAKEOVER=1 make aws-down tries the teardown again."
  exit 0
fi
# Another make aws-down holds the door, and may still wait at its prompt:
# taking its hold would leave its release unable to delete the entry. Only an
# explicit TAKEOVER=1, for a teardown that was canceled or abandoned, does.
if [[ $mode == hold && -n $held_by && $held_by != "$teardown" ]]; then
  if [[ ${TAKEOVER:-} != 1 ]]; then
    echo "Another make aws-down holds the API's door, and may still be running: let it finish." >&2
    echo "If it was canceled or abandoned: TAKEOVER=1 make aws-down" >&2
    exit 1
  fi
  echo "Taking over the door from an earlier make aws-down, as TAKEOVER=1 asks."
fi

# Step 1: the closing entry, over the version just read.
closing=$(session_entry closing "$teardown")
if ! put_entry "$version" "$closing"; then
  echo "CloudFront's store changed while the door was closing, maybe from another terminal: run make aws-down again." >&2
  exit 1
fi
echo "Closing the API's door: new questions get the offline answer, while runs already started finish."

# Step 2. Every 0.2 seconds, for up to 2 minutes, however long each check takes.
offline=0
deadline=$((SECONDS + 120))
while ((offline < 10 && SECONDS < deadline)); do
  if curl --silent --max-time 5 "$url/api/health" | grep -q '"status":"offline"'; then
    offline=$((offline + 1))
  else
    offline=0
  fi
  sleep 0.2
done
if ((offline < 10)); then
  echo "CloudFront still sends health checks to the backend after 2 minutes, so the stack stays up." >&2
  echo "Try make aws-down again. To destroy it without waiting: terraform -chdir=infra/aws/session destroy" >&2
  exit 1
fi

# The store's version that passed the checks must still hold this close's
# entry, and nothing may change it during the wait.
version=$(store_version)
checked=$(read_entry)
checked_by=$(entry_field "$checked" teardown)
if ! closing_for "$checked" "$stack_up" || [[ $checked_by != "$teardown" ]]; then
  echo "Someone changed the API's door during the checks, so the stack stays up." >&2
  exit 1
fi
echo "CloudFront answers offline. Waiting 60 seconds more, for runs in flight to finish."
sleep 60
now=$(store_version)
if [[ $now != "$version" ]]; then
  echo "CloudFront's store changed during the wait, as when the door is reopened, so the stack stays up." >&2
  exit 1
fi

if [[ $mode == hold ]]; then
  echo "The API's door is closed, and stays closed while terraform destroy runs."
  echo "If you cancel the destroy, the door stays closed: FORCE_OPEN=1 make aws-open reopens it, and TAKEOVER=1 make aws-down tries the teardown again."
  exit 0
fi
if ! delete_entry "$version"; then
  echo "CloudFront's store changed just before the delete, so the door stays as it is." >&2
  exit 1
fi
echo "The API's door is closed."
