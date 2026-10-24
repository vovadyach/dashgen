import pytest
from fastapi.testclient import TestClient

from gateway.config import Settings
from gateway.main import create_app


@pytest.fixture
def settings() -> Settings:
    return Settings(
        gemini_api_key="test-key",
        metrics_base_url="http://metrics.test",
        allowed_origins=["http://localhost:5173"],
        _env_file=None,
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))
