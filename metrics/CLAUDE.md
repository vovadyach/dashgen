# Metrics service

Go, standard library only. Serves the sample metrics over HTTP: `GET /health`, `GET /services` and `GET /metrics?service=&metric=&days=`.

- Run it with `make metrics` from the repo root (port 8080). Settings come from the environment, never a `.env` file: `PORT=8081 make metrics`.
- Checks: `gofmt -l .`, `go vet ./...` and `go test ./...`.
- The data is hardcoded in `data.go` until step 2 moves it to Postgres.

## Conventions

- No third-party modules without the user's OK. Step 2 will need a Postgres driver.
- Responses go through `writeJSON`, and errors through `writeError`, which sends `{"error": "..."}` with the status code.
- Routes are wired in `newHandler()`, which `main` and the tests share. Test handlers through it with `net/http/httptest`, as table-driven tests.
