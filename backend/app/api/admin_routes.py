"""Admin routes + per-user settings."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..auth import get_current_user, require_admin
from ..database import SessionLocal, SystemConfig, User, UserSettings

router = APIRouter()


# ---------- Admin: user management ----------

@router.get("/admin/users")
async def list_users(admin: User = Depends(require_admin)):
    async with SessionLocal() as s:
        res = await s.execute(select(User).order_by(User.id.asc()))
        return {"items": [u.to_dict() for u in res.scalars().all()]}


class RoleUpdate(BaseModel):
    role: str


@router.patch("/admin/users/{uid}/role")
async def set_user_role(uid: int, payload: RoleUpdate, admin: User = Depends(require_admin)):
    if uid == admin.id:
        raise HTTPException(400, "不能修改自己的角色")
    if payload.role not in ("admin", "user"):
        raise HTTPException(400, "角色只能是 admin 或 user")
    async with SessionLocal() as s:
        u = await s.get(User, uid)
        if not u:
            raise HTTPException(404, "用户不存在")
        u.role = payload.role
        await s.commit()
        await s.refresh(u)
        return u.to_dict()


# ---------- Admin: system config ----------

@router.get("/admin/config")
async def get_system_config(admin: User = Depends(require_admin)):
    async with SessionLocal() as s:
        res = await s.execute(select(SystemConfig))
        configs = {c.key: c.value for c in res.scalars().all()}
    return configs


class SystemConfigUpdate(BaseModel):
    registration_open: Optional[str] = None


@router.put("/admin/config")
async def update_system_config(payload: SystemConfigUpdate, admin: User = Depends(require_admin)):
    async with SessionLocal() as s:
        if payload.registration_open is not None:
            cfg = await s.get(SystemConfig, "registration_open")
            if cfg:
                cfg.value = payload.registration_open
            else:
                s.add(SystemConfig(key="registration_open", value=payload.registration_open))
        await s.commit()
        res = await s.execute(select(SystemConfig))
        return {c.key: c.value for c in res.scalars().all()}


# ---------- Per-user settings ----------

@router.get("/my-settings")
async def get_my_settings(user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        result = await s.execute(
            select(UserSettings).where(UserSettings.user_id == user.id)
        )
        us = result.scalars().first()
    if not us:
        return {
            "use_own_key": False,
            "openai_api_key_mask": "",
            "openai_api_key_set": False,
            "openai_base_url": "",
            "chat_model": "",
            "image_model": "",
        }
    return us.to_dict()


class MySettingsUpdate(BaseModel):
    use_own_key: Optional[bool] = None
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    chat_model: Optional[str] = None
    image_model: Optional[str] = None


@router.put("/my-settings")
async def update_my_settings(payload: MySettingsUpdate, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        result = await s.execute(
            select(UserSettings).where(UserSettings.user_id == user.id)
        )
        us = result.scalars().first()
        if not us:
            us = UserSettings(user_id=user.id)
            s.add(us)

        data = payload.model_dump(exclude_unset=True)
        for k, v in data.items():
            if v is not None:
                setattr(us, k, v)

        await s.commit()
        await s.refresh(us)
        return us.to_dict()
