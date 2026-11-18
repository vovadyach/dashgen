#!/usr/bin/env bash
# make aws-image: builds the backend's image for Fargate's ARM CPUs, and
# pushes it to the session stack's ECR repository (infra/aws/session/ecr.tf),
# tagged with its commit, and as latest, which the task definitions use.
set -euo pipefail

cd "$(dirname "$0")/.."

# With the stack down, terraform output prints nothing, and still succeeds.
# Its own errors, like an expired sign-in, show as they are.
repo=$(terraform -chdir=infra/aws/session output -raw ecr_repository_url)
if [[ -z $repo ]]; then
  echo "The session stack isn't up: run make aws-up first." >&2
  exit 1
fi
# Only an ECR address goes on: docker login with any other would send ECR's
# sign-in token to that registry, like Docker Hub for an empty one.
if [[ ! $repo =~ ^[0-9]{12}\.dkr\.ecr\.us-east-1\.amazonaws\.com/dashgen-backend$ ]]; then
  echo "Not the session's ECR repository: $repo" >&2
  exit 1
fi

# The commit. When any file differs from it, untracked ones too, since Docker
# copies those as well, the tag says dirty, with the time, so it never stands
# for code the commit doesn't have.
tag=$(git rev-parse --short HEAD)
if [[ -n $(git status --porcelain) ]]; then
  tag="$tag-dirty-$(date -u +%Y%m%dT%H%M%SZ)"
fi

# Signs Docker in to ECR for 12 hours. The password goes through the pipe,
# never on a command line.
aws ecr get-login-password --region us-east-1 |
  docker login --username AWS --password-stdin "${repo%%/*}"

docker build --platform linux/arm64 --file backend/Dockerfile \
  --tag "$repo:$tag" --tag "$repo:latest" .
# Only this build's two tags. --all-tags would also push older local tags,
# like last session's images.
docker push "$repo:$tag"
docker push "$repo:latest"

echo "Pushed the backend's image: $tag, also as latest."
