#!/usr/bin/env bash
# make aws-start: runs the backend's service (infra/aws/session/service.tf) on
# the image tagged latest now, as exactly one task, and waits until the load
# balancer finds it healthy. make aws-up runs it after the image and the
# migrations, and make aws-deploy runs it to deploy new code during a session.
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/aws-session.sh

cluster=$(output cluster)
service=$(output backend_service)
log_group=$(output backend_log_group)
require_image "$(output ecr_repository_url)"

# One task, in a new deployment, which pulls latest again even when the tag
# itself hasn't moved.
deployment=$(aws ecs update-service --cluster "$cluster" --service "$service" \
  --desired-count 1 --force-new-deployment \
  --query 'service.deployments[?status==`PRIMARY`].id | [0]' --output text)

echo "Starting the backend. It takes about 2 minutes."
# COMPLETED once the load balancer finds the new task healthy. FAILED once
# ECS's circuit breaker gives up on it, and None once a rollback has replaced
# it. Checked every 10 seconds, for up to 10 minutes.
for _ in {1..60}; do
  state=$(aws ecs describe-services --cluster "$cluster" --services "$service" \
    --query "services[0].deployments[?id=='$deployment'].rolloutState | [0]" \
    --output text)
  case $state in
    COMPLETED)
      echo "The backend is up, and the load balancer finds it healthy."
      exit 0
      ;;
    FAILED | None)
      echo "The backend didn't start. Why ECS stopped its last task:" >&2
      stopped=$(aws ecs list-tasks --cluster "$cluster" --service-name "$service" \
        --desired-status STOPPED --query 'taskArns[0]' --output text)
      aws ecs describe-tasks --cluster "$cluster" --tasks "$stopped" \
        --query 'tasks[0].[stoppedReason, containers[0].reason]' --output text >&2 || true
      echo "Its output is in the log group $log_group." >&2
      exit 1
      ;;
  esac
  sleep 10
done

echo "The backend still isn't healthy after 10 minutes: see the service in ECS's console." >&2
exit 1
