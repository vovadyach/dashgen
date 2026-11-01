# Repo-wide and infrastructure commands. The TypeScript packages have npm
# scripts of their own: `npm run dev` starts the backend.
.PHONY: help install db dev fmt check clean

help:
	@echo "DashGen — available commands:"
	@echo "  make install    Install the packages for every TypeScript workspace"
	@echo "  make db         Start Postgres in Docker (localhost:5432)"
	@echo "  make dev        Start Postgres, the backend (:3000) and the page (:5173)"
	@echo "  make fmt        Format the TypeScript code"
	@echo "  make check      Run every formatter, linter, type checker and test"
	@echo "  make clean      Remove installed packages"
	@echo "  npm run dev     Run the backend (:3000), restarting on changes"
	@echo "  npm run dev:frontend  Run the page (:5173), which forwards /api to the backend"

install:
	npm ci

db:
	docker compose up --detach --wait postgres

# The backend and the page together in this terminal, each restarting on
# changes. Ctrl+C stops both, and Postgres keeps running.
dev: db
	npm run dev & npm run dev:frontend & wait

fmt:
	npm run --silent format -- --log-level warn

check:
	scripts/check.sh

clean:
	rm -rf node_modules backend/node_modules frontend/node_modules packages/*/node_modules
