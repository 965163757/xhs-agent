"""Auth routes: register, login, me."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..auth import create_access_token, get_current_user, hash_password, verify_password
from ..database import SessionLocal, User

router = APIRouter()


class AuthRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=4, max_length=128)


class TokenResponse(BaseModel):
    token: str
    user: dict


@router.post("/register")
async def register(req: AuthRequest):
    async with SessionLocal() as s:
        existing = await s.execute(select(User).where(User.username == req.username))
        if existing.scalars().first():
            raise HTTPException(400, "用户名已存在")
        user = User(username=req.username, hashed_password=hash_password(req.password))
        s.add(user)
        await s.commit()
        await s.refresh(user)
    token = create_access_token({"sub": user.id})
    return {"token": token, "user": user.to_dict()}


@router.post("/login")
async def login(req: AuthRequest):
    async with SessionLocal() as s:
        result = await s.execute(select(User).where(User.username == req.username))
        user = result.scalars().first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(401, "用户名或密码错误")
    token = create_access_token({"sub": user.id})
    return {"token": token, "user": user.to_dict()}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return user.to_dict()
