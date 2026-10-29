# Repo-wide and infrastructure commands. The TypeScript packages have npm
# scripts of their own: `npm run dev` starts the backend.
.PHONY: help install db fmt check clean

help:
	@echo "DashGen — available commands:"
	@echo "  make install    Install the packages for every TypeScript workspace"
	@echo "  make db         Start Postgres in Docker (localhost:5432)"
	@echo "  make fmt        Format the TypeScript code"
	@echo "  make check      Run every formatter, linter, type checker and test"
	@echo "  make clean      Remove installed packages"
	@echo "  npm run dev     Run the backend (:3000), restarting on changes"

install:
	npm ci

db:
	docker compose up --detach --wait postgres

fmt:
	npm run --silent format -- --log-level warn

check:
	scripts/check.sh

clean:
	rm -rf node_modules backend/node_modules packages/*/node_modules
