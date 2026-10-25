# Gateway

Python 3.14 + FastAPI. Takes a question and returns a chart; the Gemini agent arrives in step 4.

- A uv project with a src layout: code in `src/gateway/`, tests in `tests/`.
- Run it with `make gateway` from the repo root: port 3000, reloads on change. API docs at http://localhost:3000/docs.
- Checks: `uv run ruff format .`, `uv run ruff check .`, `uv run mypy src tests` (strict) and `uv run pytest`.

## Conventions

- Settings live in `Settings` in `config.py` (pydantic-settings). A new setting goes there and into `.env.example`.
- `create_app(settings)` builds the app, so each test can pass its own `Settings`. Nothing else reads the environment.
- Per-route behavior, like the rate limit, is a dependency: `dependencies=[Depends(...)]`.
- Errors are raised as `HTTPException`, so clients get `{"detail": "..."}`.
- Everything is typed; mypy runs in strict mode.
- Tests use the fixtures in `tests/conftest.py` and never touch the network or Gemini. From step 4 the agent is tested with a fake model.
