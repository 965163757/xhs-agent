from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .api.diagnose import router as diagnose_router
from .api.auth_routes import router as auth_router
from .auth import get_current_user
from .config import get_settings
from .database import init_db


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

Path(settings.image_dir).mkdir(parents=True, exist_ok=True)
app.mount("/static/images", StaticFiles(directory=settings.image_dir), name="images")

app.include_router(auth_router, prefix="/api/auth")
app.include_router(router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(diagnose_router, prefix="/api", dependencies=[Depends(get_current_user)])


@app.get("/healthz")
async def healthz():
    return {"ok": True}
