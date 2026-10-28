.PHONY: help install metrics gateway db fmt check clean

help:
	@echo "DashGen — available commands:"
	@echo "  make install    Install all dependencies"
	@echo "  make metrics    Run the Go metrics service (:8080)"
	@echo "  make gateway    Run the Python gateway (:3000)"
	@echo "  make db         Start Postgres in Docker (localhost:5432)"
	@echo "  make fmt        Format the Python and Go code, and sort imports"
	@echo "  make check      Run every formatter, linter, type checker and test"
	@echo "  make clean      Remove build artifacts and the Python virtual environment"

install:
	cd gateway && uv sync --locked

metrics:
	cd metrics && go run .

gateway:
	cd gateway && uv run uvicorn gateway.main:create_app --factory --reload --port 3000

db:
	docker compose up --detach --wait postgres

fmt:
	cd gateway && uv run ruff format --config pyproject.toml . ../.claude/hooks
	cd gateway && uv run ruff check --select I --fix --config pyproject.toml . ../.claude/hooks
	cd metrics && gofmt -w .

check:
	scripts/check.sh

clean:
	rm -rf gateway/.venv
	rm -f metrics/metrics
