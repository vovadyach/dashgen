.PHONY: help install metrics gateway check clean

help:
	@echo "DashGen — available commands:"
	@echo "  make install    Install all dependencies"
	@echo "  make metrics    Run the Go metrics service (:8080)"
	@echo "  make gateway    Run the Python gateway (:3000)"
	@echo "  make check      Run every formatter, linter, type checker and test"
	@echo "  make clean      Remove build artifacts and the Python virtual environment"

install:
	cd gateway && uv sync

metrics:
	cd metrics && go run .

gateway:
	cd gateway && uv run uvicorn gateway.main:create_app --factory --reload --port 3000

check:
	scripts/check.sh

clean:
	rm -rf gateway/.venv
	rm -f metrics/metrics
