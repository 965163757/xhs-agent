"""Auth routes: register, login, me."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..auth import create_access_token, get_current_user, hash_password, verify_password
from ..database import SessionLocal, SystemConfig, User

router = APIRouter()


class AuthRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=4, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=4, max_length=128)


class TokenResponse(BaseModel):
    token: str
    user: dict


@router.post("/register")
async def register(req: AuthRequest):
    async with SessionLocal() as s:
        user_count = await s.scalar(select(func.count()).select_from(User))
        is_first = user_count == 0

        if not is_first:
            reg_cfg = await s.get(SystemConfig, "registration_open")
            if reg_cfg and reg_cfg.value == "false":
                raise HTTPException(403, "管理员已关闭注册")

        existing = await s.execute(select(User).where(User.username == req.username))
        if existing.scalars().first():
            raise HTTPException(400, "用户名已存在")

        role = "admin" if is_first else "user"
        user = User(
            username=req.username,
            hashed_password=hash_password(req.password),
            role=role,
        )
        s.add(user)

        if is_first:
            s.add(SystemConfig(key="registration_open", value="true"))

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


@router.post("/change-password")
async def change_password(req: ChangePasswordRequest, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        db_user = await s.get(User, user.id)
        if not db_user:
            raise HTTPException(404, "用户不存在")
        if not verify_password(req.current_password, db_user.hashed_password):
            raise HTTPException(400, "当前密码不正确")
        if verify_password(req.new_password, db_user.hashed_password):
            raise HTTPException(400, "新密码不能与当前密码相同")
        db_user.hashed_password = hash_password(req.new_password)
        await s.commit()
    return {"ok": True}
