#!/usr/bin/env bash
# make aws-migrate: runs the one-off task that applies the migrations and the
# seed on AWS (infra/aws/session/ecs.tf), waits for it to stop, shows its
# output, and fails when the task did.
set -euo pipefail

cd "$(dirname "$0")/.."
export AWS_REGION=us-east-1

# One of the session stack's outputs. With the stack down, terraform output
# prints nothing, and still succeeds, so an empty value stops the script. Its
# own errors, like an expired sign-in, show as they are, and stop it too: a
# command substitution doesn't inherit set -e, hence the || exit.
output() {
  local value
  value=$(terraform -chdir=infra/aws/session output -raw "$1") || exit 1
  if [[ -z $value ]]; then
    echo "The session stack isn't up: run make aws-up, then make aws-image." >&2
    exit 1
  fi
  printf '%s' "$value"
}

cluster=$(output cluster)
task_family=$(output migrate_task)
log_group=$(output migrate_log_group)
subnets=$(output private_subnets)
security_group=$(output backend_security_group)
repository=$(output ecr_repository_url)

# The task runs the image tagged latest. Without it, ECS would only fail to
# start the task a minute later, so check first. Any other error, like an
# expired sign-in, shows as it is.
if ! error=$(aws ecr describe-images --repository-name "${repository#*/}" \
  --image-ids imageTag=latest 2>&1 >/dev/null); then
  if [[ $error == *ImageNotFoundException* ]]; then
    echo "There's no image to run yet: run make aws-image first." >&2
  else
    echo "$error" >&2
  fi
  exit 1
fi

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
# stopped it before it ran, like an image that isn't there yet.
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
