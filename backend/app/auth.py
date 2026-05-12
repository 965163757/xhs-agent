"""JWT authentication utilities."""
from __future__ import annotations

import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select

from .config import DATA_DIR, get_settings, _load_overlay, OVERLAY_PATH
from .database import SessionLocal, User

import json

ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
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
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


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
        payload = jwt.decode(token, _get_secret(), algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效 token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效 token")

    async with SessionLocal() as s:
        user = await s.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user
