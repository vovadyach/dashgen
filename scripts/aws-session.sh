# Sourced by the scripts behind make aws-up (scripts/aws-*.sh), from the repo's
# root: reads the session stack's outputs, and checks for the backend's image.

export AWS_REGION=us-east-1

# Prints one of the session stack's outputs (infra/aws/session/outputs.tf).
# With the stack down, terraform output prints nothing, and still succeeds, so
# an empty value stops the script. Its own errors, like an expired sign-in,
# show as they are, and stop it too: a command substitution doesn't inherit
# set -e, hence the || exit.
output() {
  local value
  value=$(terraform -chdir=infra/aws/session output -raw "$1") || exit 1
  if [[ -z $value ]]; then
    echo "The session stack isn't up: run make aws-up." >&2
    exit 1
  fi
  printf '%s' "$value"
}

# Stops the script unless the ECR repository at $1 has an image tagged latest,
# which the task definitions run. Without it, ECS would only fail to start a
# task a minute later. Any other error, like an expired sign-in, shows as it
# is.
require_image() {
  local error
  if ! error=$(aws ecr describe-images --repository-name "${1#*/}" \
    --image-ids imageTag=latest 2>&1 >/dev/null); then
    if [[ $error == *ImageNotFoundException* ]]; then
      echo "There's no image to run yet: run make aws-image first." >&2
    else
      echo "$error" >&2
    fi
    exit 1
  fi
}
