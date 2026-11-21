# Repo-wide and infrastructure commands. The TypeScript packages have npm
# scripts of their own: `npm run dev` starts the backend.
.PHONY: help install db dev fmt check clean aws-up aws-deploy aws-image aws-migrate aws-start aws-open aws-close aws-down

help:
	@echo "DashGen — available commands:"
	@echo "  make install    Install the packages for every TypeScript workspace"
	@echo "  make db         Start Postgres (localhost:5432) and DynamoDB Local (:8000) in Docker"
	@echo "  make dev        Start them, the backend (:3000) and the page (:5173)"
	@echo "  make fmt        Format the TypeScript code"
	@echo "  make check      Run every formatter, linter, type checker and test"
	@echo "  make clean      Remove installed packages"
	@echo "  make aws-up     Build the session stack on AWS, after showing its plan, deploy the backend, and open the API's door (costs money by the hour; needs the model's key, TF_VAR_gemini_api_key or TF_VAR_anthropic_api_key)"
	@echo "  make aws-deploy Deploy the backend's code: its image, the migrations, then the backend"
	@echo "  make aws-image  Build the backend's image for ARM, and push it to ECR"
	@echo "  make aws-migrate  Run the migrations and the seed on AWS, as a one-off ECS task"
	@echo "  make aws-start  Run the backend on ECS, on its newest image, until it's healthy"
	@echo "  make aws-open   Open the API's door: CloudFront sends /api/* to the session's backend"
	@echo "  make aws-close  Close the API's door, and wait for questions in flight to finish"
	@echo "  make aws-down   Close the door, then destroy the session stack: end every AWS work session with it"
	@echo "  npm run dev     Run the backend (:3000), restarting on changes"
	@echo "  npm run dev:frontend  Run the page (:5173), which forwards /api to the backend"

install:
	npm ci

db:
	docker compose up --detach --wait postgres dynamodb

# The backend and the page together in this terminal, each restarting on
# changes. Ctrl+C stops both, and so does either one stopping by itself;
# Postgres and DynamoDB Local keep running. `kill 0` ends this recipe's whole
# process group, make included, so make then reports "Terminated".
dev: db
	@trap 'kill 0' EXIT; \
	npm run dev & back=$$!; \
	npm run dev:frontend & front=$$!; \
	while kill -0 $$back 2>/dev/null && kill -0 $$front 2>/dev/null; do sleep 1; done

fmt:
	npm run --silent format -- --log-level warn

check:
	scripts/check.sh

clean:
	rm -rf node_modules backend/node_modules frontend/node_modules packages/*/node_modules

# The session stack, infra/aws/session: what runs on AWS only while DashGen is
# being worked on, and costs money by the hour (docs/runbooks/deploy.md).
# Terraform here touches only that stack, never infra/aws/account or
# infra/aws/always-on, which stay. From those, the scripts only read outputs,
# and write two things: the session's entry in CloudFront's store, which the
# session owns (ADR-0003), and the backend's images in ECR (ADR-0017).
# Terraform shows what it will do, and asks before it changes anything. init
# runs first, so a new machine works too. aws-up also
# needs the model's key, for the backend's secret: TF_VAR_gemini_api_key for a
# Gemini model, the default, or TF_VAR_anthropic_api_key when TF_VAR_ai_model
# names a Claude one. Without it, the secret would hold only a placeholder.
SESSION = terraform -chdir=infra/aws/session
ALWAYS_ON = terraform -chdir=infra/aws/always-on

# Both stacks' backends, before any script reads their state: on a new
# machine, a read before init fails.
INIT = $(SESSION) init -input=false -backend-config=../backend.hcl >/dev/null && \
	$(ALWAYS_ON) init -input=false -backend-config=../backend.hcl >/dev/null

aws-up:
	@case "$$TF_VAR_ai_model" in claude-*) key=TF_VAR_anthropic_api_key ;; *) key=TF_VAR_gemini_api_key ;; esac; \
	test -n "$$(printenv $$key)" || { echo "Set $$key to the API key for $${TF_VAR_ai_model:-the default Gemini model} first: docs/runbooks/deploy.md#the-session-stack"; exit 1; }
	$(INIT)
	$(SESSION) apply
	$(MAKE) --no-print-directory aws-deploy
	scripts/aws-open.sh

# The backend's code on AWS, in order: its image, built for Fargate's ARM CPUs
# and pushed to ECR, in the always-on stack; the one-off task that applies the
# migrations and the seed; then the backend's service, on that image.
# make aws-up runs it after Terraform, and during a session it deploys new
# code. Each step also runs alone, and checks the one before it.
aws-deploy:
	scripts/aws-image.sh
	scripts/aws-migrate.sh
	scripts/aws-start.sh

aws-image:
	scripts/aws-image.sh

aws-migrate:
	scripts/aws-migrate.sh

aws-start:
	scripts/aws-start.sh

# The API's door (ADR-0003): make aws-up opens it once the backend is
# healthy, and make aws-down closes it first, waiting for questions in flight.
aws-open:
	$(INIT)
	scripts/aws-open.sh

aws-close:
	$(INIT)
	scripts/aws-close.sh

# The closing entry stays while terraform destroy runs, marked with this
# teardown's random id, so make aws-open can't reopen the door to a stack
# that's going, and make aws-close leaves it alone. Only this teardown's
# release deletes it. If the destroy is canceled, the door stays closed.
aws-down:
	$(INIT)
	@teardown=$$(node -e 'process.stdout.write(require("node:crypto").randomUUID())') && \
	scripts/aws-close.sh hold "$$teardown" && \
	$(SESSION) destroy && \
	scripts/aws-close.sh release "$$teardown"
