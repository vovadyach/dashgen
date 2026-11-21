#!/usr/bin/env bash
# The deploy-backend job in .github/workflows/ci.yml, after each merge to
# main, as the dashgen-backend-deploy role (infra/aws/always-on/github.tf):
# builds the backend's image from main and pushes it to ECR, tagged
# main-<commit> and main (ADR-0017). When a session runs main, it then runs
# the migrations and restarts the backend on that image, pinned by its
# digest, as make aws-deploy does, holding the session's deploy lock. Between
# sessions, or while one runs dev or is still starting, it only pushes. It
# reads no Terraform state: the session's parts have fixed names, and the
# backend's service gives the network.
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/aws-session.sh

cluster=dashgen
service=dashgen-backend
commit=$(git rev-parse HEAD)
tag="main-$(git rev-parse --short HEAD)"

# The commit that main's image comes from now, by its main-<commit> tag. A
# run moves main only when git confirms that its own commit is that one, or
# newer, a descendant of it: GitHub doesn't promise to start runs in merge
# order, and a rerun builds its old commit, so an older run changes nothing.
# When git can't tell, as after a rewrite of main's history, the job fails
# rather than guess. Runs on main go one at a time (the workflow's
# concurrency group), so main can't move between this check and the push,
# and the checkout has main's whole history (fetch-depth: 0).
if published=$(aws ecr describe-images --repository-name dashgen-backend \
  --image-ids imageTag=main --query 'imageDetails[0].imageTags' \
  --output text 2>&1); then
  short=$(awk -F'\t' '{ for (i = 1; i <= NF; i++) if ($i ~ /^main-[0-9a-f]+$/) { print substr($i, 6); exit } }' <<<"$published")
  published_commit=
  if [[ -n $short ]]; then
    published_commit=$(git rev-parse --verify --quiet "$short^{commit}" || true)
  fi
  if [[ -z $published_commit ]] ||
    ! git merge-base --is-ancestor "$published_commit" "$commit"; then
    if [[ -n $published_commit ]] &&
      git merge-base --is-ancestor "$commit" "$published_commit"; then
      echo "main's image already comes from a newer commit, ${published_commit:0:7}, so this run of ${commit:0:7} changes nothing."
      exit 0
    fi
    echo "Git can't confirm that this run's commit, ${commit:0:7}, is the one main's image comes from (${short:-no main-<commit> tag}) or newer, so nothing changes. If main's history was rewritten, delete that tag with aws ecr batch-delete-image --repository-name dashgen-backend --image-ids imageTag=main, then rerun this job." >&2
    exit 1
  fi
elif [[ $published != *ImageNotFoundException* ]]; then
  echo "$published" >&2
  exit 1
fi

repo=$(aws ecr describe-repositories --repository-names dashgen-backend \
  --query 'repositories[0].repositoryUri' --output text)
# A rerun of the same commit keeps the image its first run pushed, so main
# stays on that digest, which ECS may still run, or go back to.
if image_exists "$repo" "$tag"; then
  echo "The image $tag is already in ECR, from an earlier run of this commit: keeping it."
  tag_image "$repo" "$tag" main
else
  push_image "$repo" "$tag" main
fi
image=$(image_by_digest "$repo" "$tag")

# From here to the backend's update, this job holds the session's deploy
# lock, so a deploy from make waits for it, or it waits for one. Without the
# lock's table, no session is up.
if ! lock_deploys dashgen-deploy-lock; then
  echo "No session is up, so the image waits for the next make aws-up."
  exit 0
fi

# The task definition the backend's service runs, and how many tasks it asks
# for. While make aws-up or make aws-down runs, the cluster or the service can
# be missing; any other failure, like a missing permission, stops the job.
if ! found=$(aws ecs describe-services --cluster "$cluster" \
  --services "$service" \
  --query 'services[?status==`ACTIVE`].[taskDefinition, desiredCount] | [0]' \
  --output text 2>&1); then
  if [[ $found != *ClusterNotFoundException* ]]; then
    echo "$found" >&2
    exit 1
  fi
  found=None
fi
read -r running desired <<<"$found"
if [[ $running == None ]]; then
  echo "No session is up, so the image waits for the next make aws-up."
  exit 0
fi
if [[ $desired == 0 ]]; then
  echo "make aws-up is still starting the session, and deploys the session's image itself."
  exit 0
fi

# The ImageTag that pin_task_definition gave the definition: main or dev.
runs=$(aws ecs describe-task-definition --task-definition "$running" \
  --include TAGS --query "tags[?key=='ImageTag'].value | [0]" --output text)
if [[ $runs != main ]]; then
  echo "The session runs the ${runs/None/unknown} image, not main, so it's left as it is."
  exit 0
fi

# The migrations, in the backend's own network, then the backend, both on
# this commit's image. The migrations' output stays in their log group, since
# this job's log is public.
network=$(aws ecs describe-services --cluster "$cluster" --services "$service" \
  --query 'services[0].networkConfiguration' --output json)
migrate=$(pin_task_definition dashgen-migrate-template dashgen-migrate "$image" main)
backend=$(pin_task_definition dashgen-backend-template dashgen-backend "$image" main)
echo "Deploying $tag, ${image##*@}, to the session."
run_migrations "$cluster" "$migrate" "$network" ""
restart_backend "$cluster" "$service" /dashgen/backend "$backend"
