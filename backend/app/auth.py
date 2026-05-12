"""JWT authentication utilities."""
from __future__ import annotations

import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select

from .config import DATA_DIR, get_settings, _load_overlay, OVERLAY_PATH
from .database import SessionLocal, User

import json

ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 7

security = HTTPBearer(auto_error=False)

_secret_lock = threading.Lock()
_cached_secret: Optional[str] = None


def _get_secret() -> str:
    global _cached_secret
    if _cached_secret:
        return _cached_secret
    s = get_settings()
    if s.jwt_secret:
        _cached_secret = s.jwt_secret
        return _cached_secret
    with _secret_lock:
        if _cached_secret:
            return _cached_secret
        overlay = _load_overlay()
        if overlay.get("jwt_secret"):
            _cached_secret = overlay["jwt_secret"]
            return _cached_secret
        secret = secrets.token_urlsafe(32)
        overlay["jwt_secret"] = secret
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        OVERLAY_PATH.write_text(json.dumps(overlay, ensure_ascii=False, indent=2), "utf-8")
        _cached_secret = secret
        return secret


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(days=TOKEN_EXPIRE_DAYS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, _get_secret(), algorithm=ALGORITHM)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=[ALGORITHM], options={"verify_sub": False})
        raw_sub = payload.get("sub")
        if raw_sub is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效 token")
        user_id = int(raw_sub)
    except (JWTError, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效 token")

    async with SessionLocal() as s:
        user = await s.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user


async def require_admin(
    user: User = Depends(get_current_user),
) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user
