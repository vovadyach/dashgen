#!/usr/bin/env bash
# make aws-deploy: the backend's code on AWS, holding the session's deploy
# lock throughout, so a deploy from CI or another terminal waits for it, and
# it waits for theirs. Under the lock, it reads which image the session runs.
# In a session that runs dev, it builds your own code's image, pushes it to
# ECR, and deploys that build, by its own tag. In one that runs main, it
# deploys the image that main points to now, CI's newest (ADR-0017). The
# migrations, then the backend, run on that one image, pinned by its digest,
# so they run the same code, however the tags move meanwhile.
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/aws-session.sh

cluster=$(output cluster)
service=$(output backend_service)
backend_template=$(output backend_template)
backend_log_group=$(output backend_log_group)
migrate_template=$(output migrate_template)
migrate_log_group=$(output migrate_log_group)
subnets=$(output private_subnets)
security_group=$(output backend_security_group)
lock_table=$(output deploy_lock_table)
repo=$(output ecr_repository_url)

if ! lock_deploys "$lock_table"; then
  echo "The session has no deploy lock table: it's older than this code. Run make aws-up." >&2
  exit 1
fi
image_tag=$(output image_tag)
if [[ $image_tag == dev ]]; then
  # By the build's own tag, not dev, which another checkout's make aws-image
  # can move meanwhile.
  tag=$(dev_image_tag)
  push_image "$repo" "$tag" dev
  image=$(image_by_digest "$repo" "$tag")
else
  require_image "$repo" "$image_tag"
  image=$(image_by_digest "$repo" "$image_tag")
fi
migrate=$(pin_task_definition "$migrate_template" dashgen-migrate "$image" "$image_tag")
backend=$(pin_task_definition "$backend_template" dashgen-backend "$image" "$image_tag")
echo "Deploying the $image_tag image, ${image##*@}."

# In the private subnets, in the backend's security group, with no public IP.
run_migrations "$cluster" "$migrate" \
  "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=DISABLED}" \
  "$migrate_log_group"
restart_backend "$cluster" "$service" "$backend_log_group" "$backend"
