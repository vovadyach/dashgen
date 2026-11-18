# Repo-wide and infrastructure commands. The TypeScript packages have npm
# scripts of their own: `npm run dev` starts the backend.
.PHONY: help install db dev fmt check clean aws-up aws-image aws-migrate aws-down

help:
	@echo "DashGen — available commands:"
	@echo "  make install    Install the packages for every TypeScript workspace"
	@echo "  make db         Start Postgres (localhost:5432) and DynamoDB Local (:8000) in Docker"
	@echo "  make dev        Start them, the backend (:3000) and the page (:5173)"
	@echo "  make fmt        Format the TypeScript code"
	@echo "  make check      Run every formatter, linter, type checker and test"
	@echo "  make clean      Remove installed packages"
	@echo "  make aws-up     Build the session stack on AWS, after showing its plan (costs money by the hour; needs TF_VAR_gemini_api_key)"
	@echo "  make aws-image  Build the backend's image for ARM, and push it to the session's ECR"
	@echo "  make aws-migrate  Run the migrations and the seed on AWS, as a one-off ECS task"
	@echo "  make aws-down   Destroy the session stack: end every AWS work session with it"
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
# Both commands touch only that stack, never infra/aws/account or
# infra/aws/always-on, which stay. Terraform shows what it will do, and asks
# before it changes anything. init runs first, so a new machine works too.
# aws-up also needs the Gemini key in TF_VAR_gemini_api_key, for the backend's
# secret; without it, the secret would hold only a placeholder.
SESSION = terraform -chdir=infra/aws/session

aws-up:
	@test -n "$$TF_VAR_gemini_api_key" || { echo "Set TF_VAR_gemini_api_key to DashGen's Gemini API key first: docs/runbooks/deploy.md#the-session-stack"; exit 1; }
	$(SESSION) init -input=false -backend-config=../backend.hcl
	$(SESSION) apply

# After make aws-up: the backend's image, built for Fargate's ARM CPUs and
# pushed to the session's ECR, then the one-off task that applies the
# migrations and the seed to the session's database.
aws-image:
	scripts/aws-image.sh

aws-migrate:
	scripts/aws-migrate.sh

aws-down:
	$(SESSION) init -input=false -backend-config=../backend.hcl
	$(SESSION) destroy
