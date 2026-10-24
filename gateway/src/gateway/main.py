from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from gateway.config import Settings
from gateway.rate_limit import RateLimit


class AskRequest(BaseModel):
    question: str = Field(min_length=1)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    ask_limit = RateLimit("10/minute")

    app = FastAPI(title="DashGen gateway")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/ask", dependencies=[Depends(ask_limit)])
    async def ask(body: AskRequest) -> None:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Not implemented yet.",
        )

    return app
