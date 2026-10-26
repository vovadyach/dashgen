from fastapi.testclient import TestClient

from gateway.config import Settings
from gateway.main import create_app

QUESTION = {"question": "Show errors for payments-service this week"}


def test_health(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ask_is_not_implemented_yet(client: TestClient) -> None:
    assert client.post("/ask", json=QUESTION).status_code == 501


def test_ask_requires_a_question(client: TestClient) -> None:
    assert client.post("/ask", json={}).status_code == 422
    assert client.post("/ask", json={"question": ""}).status_code == 422


def test_ask_is_rate_limited_per_client_ip(settings: Settings) -> None:
    app = create_app(settings)
    first_ip = TestClient(app, client=("203.0.113.1", 50000))
    second_ip = TestClient(app, client=("203.0.113.2", 50000))

    for _ in range(10):
        assert first_ip.post("/ask", json=QUESTION).status_code == 501
    limited = first_ip.post("/ask", json=QUESTION)

    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) >= 1
    assert second_ip.post("/ask", json=QUESTION).status_code == 501


def test_health_is_not_rate_limited(client: TestClient) -> None:
    for _ in range(15):
        assert client.get("/health").status_code == 200


def test_cors_allows_the_configured_origin(
    client: TestClient, settings: Settings
) -> None:
    origin = settings.allowed_origins[0]
    response = client.options(
        "/ask",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_other_origins(client: TestClient) -> None:
    response = client.options(
        "/ask",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
