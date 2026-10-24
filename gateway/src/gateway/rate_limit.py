import math
import time

from fastapi import HTTPException, Request, status
from limits import parse
from limits.aio.storage import MemoryStorage
from limits.aio.strategies import MovingWindowRateLimiter


class RateLimit:
    """FastAPI dependency that limits how often each client IP can call a route."""

    def __init__(self, limit: str) -> None:
        self._item = parse(limit)
        self._limiter = MovingWindowRateLimiter(MemoryStorage())

    async def __call__(self, request: Request) -> None:
        # Behind a load balancer, uvicorn's --forwarded-allow-ips setting makes
        # request.client the real client instead of the load balancer.
        client_ip = request.client.host if request.client else "unknown"
        if await self._limiter.hit(self._item, client_ip):
            return
        stats = await self._limiter.get_window_stats(self._item, client_ip)
        retry_after = max(1, math.ceil(stats.reset_time - time.time()))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded, try again later.",
            headers={"Retry-After": str(retry_after)},
        )
