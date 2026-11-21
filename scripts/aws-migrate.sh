#!/usr/bin/env bash
# make aws-migrate: runs the one-off task that applies the migrations and the
# seed on AWS (infra/aws/session/ecs.tf), on the image that the session's tag,
# main or dev, points to now, pinned by its digest, holding the session's
# deploy lock. It waits for the task to stop, shows its output, and fails
# when the task did. make aws-deploy runs the migrations and the backend on
# one image instead (scripts/aws-deploy.sh).
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/aws-session.sh

cluster=$(output cluster)
template=$(output migrate_template)
log_group=$(output migrate_log_group)
subnets=$(output private_subnets)
security_group=$(output backend_security_group)
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
migrate=$(pin_task_definition "$template" dashgen-migrate "$image" "$image_tag")

# In the private subnets, in the backend's security group, with no public IP.
run_migrations "$cluster" "$migrate" \
  "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=DISABLED}" \
  "$log_group"
