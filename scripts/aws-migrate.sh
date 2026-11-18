#!/usr/bin/env bash
# make aws-migrate: runs the one-off task that applies the migrations and the
# seed on AWS (infra/aws/session/ecs.tf), waits for it to stop, shows its
# output, and fails when the task did.
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/aws-session.sh

cluster=$(output cluster)
task_family=$(output migrate_task)
log_group=$(output migrate_log_group)
subnets=$(output private_subnets)
security_group=$(output backend_security_group)
require_image "$(output ecr_repository_url)"

# In the private subnets, in the backend's security group, with no public IP.
started=$(aws ecs run-task \
  --cluster "$cluster" \
  --task-definition "$task_family" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=DISABLED}" \
  --query '[tasks[0].taskArn, failures[0].reason]' --output text)
read -r task failure <<<"$started"
if [[ $task == None ]]; then
  echo "ECS didn't start the task: $failure" >&2
  exit 1
fi

echo "Started the migrations task. It takes about a minute."
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"

# Its output, then how it ended: the container's exit code, or why ECS
# stopped it before it ran.
aws logs tail "$log_group" \
  --log-stream-names "migrate/migrate/${task##*/}" --format short || true
ended=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
  --query 'tasks[0].[containers[0].exitCode, stoppedReason]' --output text)
read -r code reason <<<"$ended"
if [[ $code != 0 ]]; then
  echo "The migrations task failed, with exit code $code: $reason" >&2
  exit 1
fi

echo "The migrations and the seed are applied."
