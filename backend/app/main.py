from contextlib import asynccontextmanager
from collections import defaultdict
from pathlib import Path
import time

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from .api.routes import router
from .api.diagnose import router as diagnose_router
from .api.auth_routes import router as auth_router
from .api.admin_routes import router as admin_router
from .config import get_settings
from .database import init_db
from .time_utils import APP_TIME_ZONE, beijing_now_iso, utc_now_iso


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="XHS Agent", version="0.2.0", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiter: 60 requests per minute per IP."""

    def __init__(self, app, max_requests: int = 60, window: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window
        self._hits: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/healthz":
            return await call_next(request)

        ip = request.client.host if request.client else "unknown"
        now = time.time()
        hits = self._hits[ip]
        cutoff = now - self.window
        self._hits[ip] = [t for t in hits if t > cutoff]

        if len(self._hits[ip]) >= self.max_requests:
            return Response(
                content='{"detail":"请求过于频繁，请稍后再试"}',
                status_code=429,
                media_type="application/json",
            )

        self._hits[ip].append(now)
        return await call_next(request)


app.add_middleware(RateLimitMiddleware, max_requests=120, window=60)

Path(settings.image_dir).mkdir(parents=True, exist_ok=True)
app.mount("/static/images", StaticFiles(directory=settings.image_dir), name="images")

app.include_router(auth_router, prefix="/api/auth")
app.include_router(admin_router, prefix="/api")
app.include_router(router, prefix="/api")
app.include_router(diagnose_router, prefix="/api")


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "timezone": APP_TIME_ZONE,
        "now": beijing_now_iso(),
        "utc_now": utc_now_iso(),
    }
