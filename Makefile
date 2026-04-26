.PHONY: help metrics gateway frontend install clean

help:
	@echo "DashGen — available commands:"
	@echo "  make install    Install all dependencies"
	@echo "  make metrics    Run the Go metrics service (:8080)"
	@echo "  make gateway    Run the Node gateway (:3000)"
	@echo "  make frontend   Run the React frontend (:5173)"
	@echo "  make clean      Remove build artifacts and node_modules"

install:
	cd gateway && npm install
	cd frontend && npm install

metrics:
	cd metrics && go run .

gateway:
	cd gateway && npm run dev

frontend:
	cd frontend && npm run dev

clean:
	rm -rf gateway/node_modules gateway/dist
	rm -rf frontend/node_modules frontend/dist
	rm -f metrics/metrics
