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
    echo "The session stack has no $1: it isn't up, or it's older than this code. Run make aws-up." >&2
    exit 1
  fi
  printf '%s' "$value"
}

# Prints one of the always-on stack's outputs (infra/aws/always-on/outputs.tf),
# which stays up between sessions. Its errors show as they are, and stop the
# script, as an empty value does.
always_on_output() {
  local value
  value=$(terraform -chdir=infra/aws/always-on output -raw "$1") || exit 1
  if [[ -z $value ]]; then
    echo "The always-on stack has no output $1: see docs/runbooks/deploy.md#the-always-on-stack." >&2
    exit 1
  fi
  printf '%s' "$value"
}

# The API's door: the session entry in CloudFront's key-value store, at
# $store, which the caller sets (ADR-0003). Every write names the store's
# version that the script read, and fails after any change it hasn't seen,
# like a make aws-open or make aws-down in another terminal.

# The store's current version.
store_version() {
  aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$store" \
    --query ETag --output text
}

# The session entry, as JSON, or nothing when there's none. Any other error,
# like an expired sign-in, stops the script. The entry, with the secret, is
# never printed.
read_entry() {
  local reply
  if ! reply=$(aws cloudfront-keyvaluestore get-key --kvs-arn "$store" \
    --key session --query Value --output text 2>&1); then
    if [[ $reply == *ResourceNotFoundException* ]]; then
      return 0
    fi
    echo "$reply" >&2
    exit 1
  fi
  printf '%s' "$reply"
}

# The entry for this session's load balancer and secret, from Terraform's
# outputs, never from the store, so an old address never comes back. With
# "closing" as $1, it's marked closing, and $2, when given, is the id of the
# make aws-down that holds it. A failed or empty read stops it, so a missing
# output never becomes part of a route. Callers assign its output to a
# variable, where set -e sees a failure; a command substitution doesn't pass
# set -e on, hence the || exit.
session_entry() {
  local load_balancer secret
  load_balancer=$(output load_balancer) || exit 1
  secret=$(output origin_secret) || exit 1
  LOAD_BALANCER="$load_balancer" SECRET="$secret" CLOSING="${1:-}" \
    TEARDOWN="${2:-}" node -e '
      const { LOAD_BALANCER, SECRET, CLOSING, TEARDOWN } = process.env;
      if (!LOAD_BALANCER || !SECRET) process.exit(1);
      const entry = { loadBalancer: LOAD_BALANCER, secret: SECRET };
      if (CLOSING === "closing") entry.closing = true;
      if (TEARDOWN) entry.teardown = TEARDOWN;
      process.stdout.write(JSON.stringify(entry));
    '
}

# One field of the entry $1, or nothing.
entry_field() {
  ENTRY="$1" FIELD="$2" node -e '
    const { ENTRY, FIELD } = process.env;
    const value = ENTRY === "" ? undefined : JSON.parse(ENTRY)[FIELD];
    process.stdout.write(value === undefined ? "" : String(value));
  '
}

# Writes the entry $2 over the store's version $1, and only over it. The
# entry, with the secret, goes through stdin, so it's never on a command line:
# printf is part of bash, not a program with arguments of its own. Only
# --value reads stdin. The AWS CLI can't read --cli-input-json from a pipe:
# it gets nothing, and fails with "Invalid JSON received".
put_entry() {
  if [[ -z $2 ]]; then
    echo "There's no session entry to write, so the store stays as it is." >&2
    exit 1
  fi
  printf '%s' "$2" | aws cloudfront-keyvaluestore put-key --kvs-arn "$store" \
    --key session --if-match "$1" --value file:///dev/stdin >/dev/null
}

# Deletes the entry, only at the store's version $1.
delete_entry() {
  aws cloudfront-keyvaluestore delete-key --kvs-arn "$store" --key session \
    --if-match "$1" >/dev/null
}

# Whether the entry $1 is a closing entry for the load balancer $2.
closing_for() {
  ENTRY="$1" LOAD_BALANCER="$2" node -e '
    const { ENTRY, LOAD_BALANCER } = process.env;
    const entry = ENTRY === "" ? {} : JSON.parse(ENTRY);
    process.exit(entry.closing === true && entry.loadBalancer === LOAD_BALANCER ? 0 : 1);
  '
}

# Stops the script unless the ECR repository at $1 has an image tagged latest,
# which the task definitions run. Without it, ECS would only fail to start a
# task a minute later. Any other error, like an expired sign-in, shows as it
# is. The image must also be under 6 days old: ECR deletes images a week after
# their push (infra/aws/always-on/ecr.tf), maybe during this session, and ECS
# couldn't pull it again for a task it replaces. The day left covers any
# session.
require_image() {
  local pushed
  if ! pushed=$(aws ecr describe-images --repository-name "${1#*/}" \
    --image-ids imageTag=latest --query 'imageDetails[0].imagePushedAt' \
    --output text 2>&1); then
    if [[ $pushed == *ImageNotFoundException* ]]; then
      echo "There's no image to run yet: run make aws-image first." >&2
    else
      echo "$pushed" >&2
    fi
    exit 1
  fi
  # The CLI prints the time in ISO 8601, or in Unix seconds when its
  # cli_timestamp_format setting is wire. A time it can't read counts as too
  # old, so the check never passes by mistake.
  if ! PUSHED=$pushed node -e '
    const value = process.env.PUSHED;
    const ms = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value);
    process.exit(Date.now() - ms < 6 * 24 * 60 * 60 * 1000 ? 0 : 1);
  '; then
    echo "The image tagged latest was pushed at $pushed, over 6 days ago, and ECR deletes images a week after their push, maybe during this session: run make aws-image first." >&2
    exit 1
  fi
}
