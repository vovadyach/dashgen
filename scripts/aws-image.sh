#!/usr/bin/env bash
# make aws-image: builds the backend's image from your own code, for a session
# that runs dev (TF_VAR_image_tag=dev make aws-up), and pushes it to ECR, in
# the always-on stack (infra/aws/always-on/ecr.tf), tagged dev and
# dev-<commit>. It deploys nothing: make aws-deploy builds and deploys in one
# go, under the session's deploy lock, and make aws-migrate and make aws-start
# run the newest dev image. A session that runs main runs CI's image instead
# (ADR-0017), so there it builds nothing.
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/aws-session.sh

repo=$(output ecr_repository_url)
image_tag=$(output image_tag)
if [[ $image_tag != dev ]]; then
  echo "This session runs main, the image CI builds from each merge to main, so there's nothing to build. To run your own code, start a session with TF_VAR_image_tag=dev make aws-up."
  exit 0
fi

tag=$(dev_image_tag)
push_image "$repo" "$tag" dev
