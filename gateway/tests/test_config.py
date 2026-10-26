import pytest
from pydantic import ValidationError

from gateway.config import Settings


@pytest.fixture(autouse=True)
def valid_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("METRICS_BASE_URL", "http://metrics.test")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173")


def test_reads_comma_separated_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173, https://a.example")

    settings = Settings(_env_file=None)

    assert settings.allowed_origins == ["http://localhost:5173", "https://a.example"]


def test_hides_the_api_key_when_printed() -> None:
    settings = Settings(_env_file=None)

    assert "test-key" not in repr(settings)
    assert settings.gemini_api_key.get_secret_value() == "test-key"


def test_empty_value_counts_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "")

    with pytest.raises(ValidationError, match="gemini_api_key"):
        Settings(_env_file=None)


def test_needs_at_least_one_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", " , ")

    with pytest.raises(ValidationError, match="allowed_origins"):
        Settings(_env_file=None)
