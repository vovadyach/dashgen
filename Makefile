.PHONY: help install metrics gateway db fmt check clean

help:
	@echo "DashGen — available commands:"
	@echo "  make install    Install the gateway's packages"
	@echo "  make metrics    Run the Go metrics service (:8080)"
	@echo "  make gateway    Run the Node.js gateway (:3000), restarting on changes"
	@echo "  make db         Start Postgres in Docker (localhost:5432)"
	@echo "  make fmt        Format the TypeScript and Go code"
	@echo "  make check      Run every formatter, linter, type checker and test"
	@echo "  make clean      Remove installed packages and build artifacts"

install:
	cd gateway && npm ci

metrics:
	cd metrics && go run .

gateway:
	cd gateway && npm run dev

db:
	docker compose up --detach --wait postgres

fmt:
	cd gateway && npm run --silent format
	cd .claude/hooks && ../../gateway/node_modules/.bin/prettier --write --log-level warn .
	cd metrics && gofmt -w .

check:
	scripts/check.sh

clean:
	rm -rf gateway/node_modules
	rm -f metrics/metrics
