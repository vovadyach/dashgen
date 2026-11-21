#!/usr/bin/env bash
# make aws-start: runs the backend's service (infra/aws/session/service.tf) on
# the image that the session's tag, main or dev, points to now, pinned by its
# digest, as exactly one task, holding the session's deploy lock, and waits
# until the load balancer finds it healthy. make aws-deploy runs the
# migrations and the backend on one image instead (scripts/aws-deploy.sh).
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/aws-session.sh

cluster=$(output cluster)
service=$(output backend_service)
template=$(output backend_template)
log_group=$(output backend_log_group)
lock_table=$(output deploy_lock_table)
repo=$(output ecr_repository_url)

if ! lock_deploys "$lock_table"; then
  echo "The session has no deploy lock table: it's older than this code. Run make aws-up." >&2
  exit 1
fi
# Under the lock, so a switch between main and dev can't change it meanwhile.
image_tag=$(output image_tag)
require_image "$repo" "$image_tag"
image=$(image_by_digest "$repo" "$image_tag")
backend=$(pin_task_definition "$template" dashgen-backend "$image" "$image_tag")
restart_backend "$cluster" "$service" "$log_group" "$backend"
