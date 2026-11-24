# Sourced by the scripts behind make aws-up (scripts/aws-*.sh), from the repo's
# root: reads the session stack's outputs, and holds the backend's deploy
# steps, which CI's deploy shares (scripts/ci-deploy-backend.sh).

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

# The backend's image and its deploy (ADR-0017), which make aws-deploy and CI
# (scripts/ci-deploy-backend.sh) share.

# Stops the script unless the ECR repository at $1 has the backend's image
# tagged $2: main, CI's, or dev, from make aws-image, as the session runs it.
# Without it, ECS would only fail to start a task a minute later. Any other
# error, like an expired sign-in, shows as it is. A dev image must also be
# under 6 days old: ECR deletes it a week after its push
# (infra/aws/always-on/ecr.tf), maybe during this session, and ECS couldn't
# pull it again for a task it replaces. The day left covers any session. CI's
# newest 3 images stay however old they are, so main needs no such check.
require_image() {
  local pushed
  if ! pushed=$(aws ecr describe-images --repository-name "${1#*/}" \
    --image-ids "imageTag=$2" --query 'imageDetails[0].imagePushedAt' \
    --output text 2>&1); then
    if [[ $pushed != *ImageNotFoundException* ]]; then
      echo "$pushed" >&2
    elif [[ $2 == main ]]; then
      echo "There's no main image yet: CI pushes one after each merge to main. To run your own code instead: TF_VAR_image_tag=dev make aws-up." >&2
    else
      echo "There's no dev image yet: run make aws-image first." >&2
    fi
    exit 1
  fi
  [[ $2 == dev ]] || return 0
  # The CLI prints the time in ISO 8601, or in Unix seconds when its
  # cli_timestamp_format setting is wire. A time it can't read counts as too
  # old, so the check never passes by mistake.
  if ! PUSHED=$pushed node -e '
    const value = process.env.PUSHED;
    const ms = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value);
    process.exit(Date.now() - ms < 6 * 24 * 60 * 60 * 1000 ? 0 : 1);
  '; then
    echo "The dev image was pushed at $pushed, over 6 days ago, and ECR deletes it a week after its push, maybe during this session: run make aws-image first." >&2
    exit 1
  fi
}

# Builds the backend's image from this checkout, for Fargate's ARM CPUs, and
# pushes it to the ECR repository at $1, tagged $2 and $3: CI's main-<commit>
# and main, or your own code's dev-<commit> and dev. --provenance=false makes
# it one image per push: otherwise Docker pushes an index that holds the image
# and a build attestation, three entries in ECR. The label with the build's
# time gives each build its own digest: from unchanged code, Docker would
# rebuild the same image, and ECR would keep its first push time, which the
# age check and ECR's cleanup count from.
push_image() {
  # Only an ECR address goes on: docker login with any other would send ECR's
  # sign-in token to that registry.
  if [[ ! $1 =~ ^[0-9]{12}\.dkr\.ecr\.us-east-1\.amazonaws\.com/dashgen-backend$ ]]; then
    echo "Not the backend's ECR repository: $1" >&2
    exit 1
  fi
  # Signs Docker in to ECR for 12 hours. The password goes through the pipe,
  # never on a command line.
  aws ecr get-login-password |
    docker login --username AWS --password-stdin "${1%%/*}"
  docker build --platform linux/arm64 --provenance=false \
    --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --file backend/Dockerfile --tag "$1:$2" --tag "$1:$3" .
  # Only this build's two tags. --all-tags would also push older local tags,
  # like last session's images.
  docker push "$1:$2"
  docker push "$1:$3"
  echo "Pushed the backend's image: $2, also as $3."
}

# The tag for an image of this checkout: dev-<commit>. When any file differs
# from the commit, untracked ones too, since Docker copies those as well, it
# says dirty, with the time and 6 random hex digits, so it never stands for
# code the commit doesn't have, and two checkouts that build in the same
# second never share one.
dev_image_tag() {
  local tag
  tag="dev-$(git rev-parse --short HEAD)"
  if [[ -n $(git status --porcelain) ]]; then
    tag="$tag-dirty-$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  printf '%s' "$tag"
}

# Stops make aws-up from switching a session that runs dev to main only
# because TF_VAR_image_tag isn't set, as when it runs again to switch models.
# A switch needs the variable. With no session up, Terraform prints nothing
# and succeeds, and a session older than this code has no image_tag output:
# neither has anything to keep. Any other failure, like a state read that
# failed, stops make aws-up, since the default would then switch dev to main.
keep_image_tag() {
  local current errors
  errors=$(mktemp)
  if ! current=$(terraform -chdir=infra/aws/session output -no-color -raw image_tag 2>"$errors"); then
    if ! grep -q 'Output "image_tag" not found' "$errors"; then
      cat "$errors" >&2
      rm -f "$errors"
      exit 1
    fi
    current=
  fi
  rm -f "$errors"
  if [[ $current == dev && -z ${TF_VAR_image_tag:-} ]]; then
    echo "This session runs dev, your own code, and without TF_VAR_image_tag, make aws-up would switch it to main. To keep dev: TF_VAR_image_tag=dev make aws-up. To switch to main: TF_VAR_image_tag=main make aws-up." >&2
    exit 1
  fi
}

# One deploy at a time per session, CI's or make's, so two never interleave
# and leave the older image running. lock_deploys takes the one item in the
# session's lock table, $1 (infra/aws/session/deploy_lock.tf), waiting while
# another deploy holds it, for up to 30 minutes, and gives it back when the
# script ends, however it ends. A lock lasts 30 minutes from its last check
# (hold_lock), so one that a stopped deploy left expires. Without the table,
# as with no session up, it returns 1.
lock_deploys() {
  local now reply waited=0
  deploy_lock_table=$1
  deploy_lock_owner=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
  while :; do
    now=$(date +%s)
    if reply=$(aws dynamodb put-item --table-name "$deploy_lock_table" \
      --item "{\"lock\":{\"S\":\"deploy\"},\"owner\":{\"S\":\"$deploy_lock_owner\"},\"until\":{\"N\":\"$((now + 1800))\"}}" \
      --condition-expression 'attribute_not_exists(#lock) OR #until < :now' \
      --expression-attribute-names '{"#lock":"lock","#until":"until"}' \
      --expression-attribute-values "{\":now\":{\"N\":\"$now\"}}" 2>&1); then
      trap unlock_deploys EXIT
      return 0
    fi
    if [[ $reply == *ResourceNotFoundException* ]]; then
      return 1
    fi
    if [[ $reply != *ConditionalCheckFailedException* ]]; then
      echo "$reply" >&2
      exit 1
    fi
    if ((waited >= 1800)); then
      echo "Another deploy has held the session's deploy lock for 30 minutes, so this one stops." >&2
      exit 1
    fi
    if ((waited == 0)); then
      echo "Another deploy is running, so this one waits for it to finish."
    fi
    sleep 10
    waited=$((waited + 10))
  done
}

# Checks that this deploy still holds the lock, and renews it for 30 minutes,
# right before each change to ECS. When the lock ran out, as after a pause of
# over 30 minutes, and another deploy took it, this one stops before it
# changes anything: the other deploy is the newer one. After the check, the
# lock is this deploy's for 30 more minutes, so the change right after it
# can't land after another deploy's.
hold_lock() {
  local reply
  if ! reply=$(aws dynamodb update-item --table-name "$deploy_lock_table" \
    --key '{"lock":{"S":"deploy"}}' \
    --update-expression 'SET #until = :until' \
    --condition-expression '#owner = :owner' \
    --expression-attribute-names '{"#owner":"owner","#until":"until"}' \
    --expression-attribute-values "{\":owner\":{\"S\":\"$deploy_lock_owner\"},\":until\":{\"N\":\"$(($(date +%s) + 1800))\"}}" \
    2>&1 >/dev/null); then
    if [[ $reply == *ConditionalCheckFailedException* ]]; then
      echo "This deploy's lock ran out, and another deploy took it, so this one stops before it changes anything more." >&2
    else
      echo "$reply" >&2
    fi
    exit 1
  fi
}

# Gives the deploy lock back, unless its 30 minutes ran out and another
# deploy took it. With the session gone, there's nothing to give back. A
# deploy that started a migrations task, and didn't see it stop, as when the
# wait for it failed, keeps the lock instead, until it expires: right after a
# start, ECS can leave the task out of its lists for a moment, and within 30
# minutes it lists it, so the next deploy waits for it (wait_for_migrations).
unlock_deploys() {
  if [[ -n ${migrations_running:-} ]]; then
    echo "The migrations task may still be running, so this deploy keeps the lock. The next deploy can start once it expires, within 30 minutes, and waits for the task to stop first." >&2
    return 0
  fi
  aws dynamodb delete-item --table-name "$deploy_lock_table" \
    --key '{"lock":{"S":"deploy"}}' \
    --condition-expression '#owner = :owner' \
    --expression-attribute-names '{"#owner":"owner"}' \
    --expression-attribute-values "{\":owner\":{\"S\":\"$deploy_lock_owner\"}}" \
    >/dev/null 2>&1 || true
}

# Whether the repository at $1 has an image tagged $2. Any other error, like
# an expired sign-in, stops the script.
image_exists() {
  local reply
  if reply=$(aws ecr describe-images --repository-name "${1#*/}" \
    --image-ids "imageTag=$2" --query 'imageDetails[0].imageDigest' \
    --output text 2>&1); then
    return 0
  fi
  if [[ $reply == *ImageNotFoundException* ]]; then
    return 1
  fi
  echo "$reply" >&2
  exit 1
}

# Prints the image tagged $2 in the repository at $1 by its digest, as
# <repository>@sha256:…, which never moves, unlike the tag.
image_by_digest() {
  local digest
  digest=$(aws ecr describe-images --repository-name "${1#*/}" \
    --image-ids "imageTag=$2" --query 'imageDetails[0].imageDigest' \
    --output text) || return 1
  printf '%s@%s' "$1" "$digest"
}

# Points tag $3 at the image tagged $2, in the repository at $1, as when CI
# reruns a commit whose image is already there. It sends ECR the image's own
# manifest, byte for byte, so the image keeps its digest. A tag already on
# that image stays as it is.
tag_image() {
  local manifest media reply
  manifest=$(mktemp)
  media=$(aws ecr batch-get-image --repository-name "${1#*/}" \
    --image-ids "imageTag=$2" \
    --query 'images[0].[imageManifest, imageManifestMediaType]' --output json |
    MANIFEST=$manifest node -e '
      let text = "";
      process.stdin.on("data", (chunk) => (text += chunk));
      process.stdin.on("end", () => {
        const [manifest, media] = JSON.parse(text);
        require("node:fs").writeFileSync(process.env.MANIFEST, manifest);
        process.stdout.write(media);
      });
    ') || { rm -f "$manifest"; return 1; }
  if ! reply=$(aws ecr put-image --repository-name "${1#*/}" --image-tag "$3" \
    --image-manifest "file://$manifest" --image-manifest-media-type "$media" \
    2>&1 >/dev/null); then
    if [[ $reply != *ImageAlreadyExistsException* ]]; then
      rm -f "$manifest"
      echo "$reply" >&2
      return 1
    fi
  fi
  rm -f "$manifest"
}

# Stops unless the backend's template family $1 gives its task
# TURNSTILE_SECRET_KEY, which the backend needs to start on AWS (ADR-0021).
# A session made before that has a template without it, and replacing a
# backend that runs with one that won't start would leave the session with
# none. Exits with $2: 0 for CI, whose image then waits for the next
# make aws-up, and 1 for make.
require_bot_check_key() {
  local secrets
  secrets=$(aws ecs describe-task-definition --task-definition "$1" \
    --query 'taskDefinition.containerDefinitions[0].secrets[].name' \
    --output text) || exit 1
  if ! grep -qw TURNSTILE_SECRET_KEY <<<"$secrets"; then
    echo "The session's backend template has no TURNSTILE_SECRET_KEY, which the backend needs to start on AWS, so the running backend stays. Run make aws-up with TF_VAR_turnstile_secret_key, which updates the template and deploys." >&2
    exit "$2"
  fi
}

# Stops unless the backend's template family $1 gives its task PAGE_URL,
# where the MCP server's chart links open, which the backend needs to start
# on AWS (ADR-0023). As with require_bot_check_key, a session made before
# that has a template without it. Exits with $2: 0 for CI, and 1 for make.
require_page_url() {
  local names
  names=$(aws ecs describe-task-definition --task-definition "$1" \
    --query 'taskDefinition.containerDefinitions[0].environment[].name' \
    --output text) || exit 1
  if ! grep -qw PAGE_URL <<<"$names"; then
    echo "The session's backend template has no PAGE_URL, which the backend needs to start on AWS, so the running backend stays. Run make aws-up, which updates the template and deploys." >&2
    exit "$2"
  fi
}

# Registers a copy of the newest revision of template family $1 in family
# $2, running image $3, pinned by digest, tagged ImageTag=$4, main or dev, and
# prints its ARN. Only Terraform registers templates, a revision on each
# apply, in families of their own, so the copy always has this stack's
# settings, like the secrets and AI_MODEL. A deploy pins both families to one
# image (ADR-0017), so the migrations and the backend run the same code,
# however main moves meanwhile, and the tag tells CI which image a session
# runs.
pin_task_definition() {
  local input arn
  input=$(mktemp)
  aws ecs describe-task-definition --task-definition "$1" \
    --query taskDefinition --output json |
    FAMILY=$2 IMAGE=$3 IMAGE_TAG=$4 node -e '
      let text = "";
      process.stdin.on("data", (chunk) => (text += chunk));
      process.stdin.on("end", () => {
        const current = JSON.parse(text);
        // Only what register-task-definition takes: the rest, like the ARN
        // and the revision, ECS sets itself.
        const fields = [
          "family", "taskRoleArn", "executionRoleArn", "networkMode",
          "containerDefinitions", "volumes", "placementConstraints",
          "requiresCompatibilities", "cpu", "memory", "runtimePlatform",
          "ephemeralStorage", "pidMode", "ipcMode", "proxyConfiguration",
        ];
        const copy = {};
        for (const field of fields) {
          if (current[field] !== undefined) copy[field] = current[field];
        }
        copy.family = process.env.FAMILY;
        copy.containerDefinitions = copy.containerDefinitions.map(
          (container) => ({ ...container, image: process.env.IMAGE }),
        );
        copy.tags = [
          { key: "Project", value: "dashgen" },
          { key: "Stack", value: "session" },
          { key: "ManagedBy", value: "deploy" },
          { key: "ImageTag", value: process.env.IMAGE_TAG },
        ];
        process.stdout.write(JSON.stringify(copy));
      });
    ' >"$input" || { rm -f "$input"; return 1; }
  # The AWS CLI reads --cli-input-json from a file, not from a pipe.
  arn=$(aws ecs register-task-definition --cli-input-json "file://$input" \
    --query taskDefinition.taskDefinitionArn --output text) || {
    rm -f "$input"
    return 1
  }
  rm -f "$input"
  printf '%s' "$arn"
}

# Prints the first migrations task in cluster $1 that ECS doesn't show as
# STOPPED, or nothing. It reads both of ECS's lists, every page, as JSON,
# since a task that ECS is stopping leaves the running list before its
# container has stopped, then asks about them 100 at a time, the most
# DescribeTasks takes. A task that ECS lists but can't describe yet counts as
# not stopped.
unstopped_migration() {
  local running stopped arns answer unstopped missing i
  local -a tasks
  running=$(aws ecs list-tasks --cluster "$1" --family dashgen-migrate \
    --desired-status RUNNING --output json) || return 1
  stopped=$(aws ecs list-tasks --cluster "$1" --family dashgen-migrate \
    --desired-status STOPPED --output json) || return 1
  arns=$(RUNNING=$running STOPPED=$stopped node -e '
    const lists = [process.env.RUNNING, process.env.STOPPED];
    process.stdout.write(lists.flatMap((list) => JSON.parse(list).taskArns).join(" "));
  ') || return 1
  read -ra tasks <<<"$arns"
  for ((i = 0; i < ${#tasks[@]}; i += 100)); do
    answer=$(aws ecs describe-tasks --cluster "$1" --tasks "${tasks[@]:i:100}" \
      --query "[tasks[?lastStatus!='STOPPED'].taskArn | [0], failures[0].arn]" \
      --output text) || return 1
    read -r unstopped missing <<<"$answer"
    if [[ $unstopped != None ]]; then
      printf '%s' "$unstopped"
      return 0
    fi
    if [[ $missing != None ]]; then
      printf '%s' "$missing"
      return 0
    fi
  done
}

# Waits until no migrations task runs in cluster $1, like one that a deploy
# started, then stopped waiting for, so two never run at once: until ECS
# shows every one as STOPPED (unstopped_migration). Checked every 10 seconds,
# for up to 10 minutes, holding the lock meanwhile.
wait_for_migrations() {
  local attempt running
  for attempt in {1..60}; do
    running=$(unstopped_migration "$1")
    if [[ -z $running ]]; then
      return 0
    fi
    if ((attempt == 1)); then
      echo "An earlier migrations task, ${running##*/}, isn't stopped yet, so this deploy waits for it."
    fi
    hold_lock
    sleep 10
  done
  echo "The earlier migrations task ${running##*/} still isn't stopped after 10 minutes, so this deploy stops: see the cluster's tasks in ECS's console." >&2
  exit 1
}

# Runs the one-off task that applies the migrations and the seed, from task
# definition $2, which pin_task_definition pinned to one image, in cluster
# $1, with the network configuration $3, in the AWS CLI's shorthand or JSON,
# once no earlier one runs, and while this deploy holds the lock. Waits for
# it to stop, and fails when the task did. With a log group as $4, it shows
# the task's output. CI passes none, since its log is public.
run_migrations() {
  local started task failure ended code reason
  wait_for_migrations "$1"
  hold_lock
  # From the start's request until the task is seen stopped, a deploy that
  # ends keeps the lock (unlock_deploys). ECS may start the task even when
  # its answer doesn't come back.
  migrations_running=1
  started=$(aws ecs run-task --cluster "$1" --task-definition "$2" \
    --launch-type FARGATE --network-configuration "$3" \
    --query '[tasks[0].taskArn, failures[0].reason]' --output text)
  read -r task failure <<<"$started"
  if [[ $task == None ]]; then
    migrations_running=
    echo "ECS didn't start the task: $failure" >&2
    exit 1
  fi

  echo "Started the migrations task. It takes about a minute."
  aws ecs wait tasks-stopped --cluster "$1" --tasks "$task"
  migrations_running=

  # Its output, then how it ended: the container's exit code, or why ECS
  # stopped it before it ran.
  if [[ -n $4 ]]; then
    aws logs tail "$4" --log-stream-names "migrate/migrate/${task##*/}" \
      --format short || true
  fi
  ended=$(aws ecs describe-tasks --cluster "$1" --tasks "$task" \
    --query 'tasks[0].[containers[0].exitCode, stoppedReason]' --output text)
  read -r code reason <<<"$ended"
  if [[ $code != 0 ]]; then
    echo "The migrations task failed, with exit code $code: $reason" >&2
    exit 1
  fi
  echo "The migrations and the seed are applied."
}

# Runs the backend's service $2, in cluster $1, as exactly one task of task
# definition $4, which pin_task_definition pinned to one image, in a new
# deployment, while this deploy holds the lock, and waits until the load
# balancer finds it healthy. When it fails, it shows why ECS stopped the
# task, and that its output is in log group $3.
restart_backend() {
  local deployment state stopped
  hold_lock
  deployment=$(aws ecs update-service --cluster "$1" --service "$2" \
    --task-definition "$4" --desired-count 1 --force-new-deployment \
    --query 'service.deployments[?status==`PRIMARY`].id | [0]' --output text)

  echo "Starting the backend. It takes about 2 minutes."
  # COMPLETED once the load balancer finds the new task healthy. FAILED once
  # ECS's circuit breaker gives up on it, and None once a rollback has
  # replaced it. Checked every 10 seconds, for up to 10 minutes.
  for _ in {1..60}; do
    state=$(aws ecs describe-services --cluster "$1" --services "$2" \
      --query "services[0].deployments[?id=='$deployment'].rolloutState | [0]" \
      --output text)
    case $state in
      COMPLETED)
        echo "The backend is up, and the load balancer finds it healthy."
        return 0
        ;;
      FAILED | None)
        echo "The backend didn't start. Why ECS stopped its last task:" >&2
        stopped=$(aws ecs list-tasks --cluster "$1" --service-name "$2" \
          --desired-status STOPPED --query 'taskArns[0]' --output text)
        aws ecs describe-tasks --cluster "$1" --tasks "$stopped" \
          --query 'tasks[0].[stoppedReason, containers[0].reason]' --output text >&2 || true
        echo "Its output is in the log group $3." >&2
        exit 1
        ;;
    esac
    sleep 10
  done

  echo "The backend still isn't healthy after 10 minutes: see the service in ECS's console." >&2
  exit 1
}
