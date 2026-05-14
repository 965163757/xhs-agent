"""Runtime settings: .env defaults + overlay persisted at data/settings.json.

Frontend can edit API key / base url / models on the fly; we write overlay to
settings.json, reload, and let services/llm rebuild its client.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Dict, List

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent


def _strip_env_quotes(value: str) -> str:
    v = (value or "").strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in {"'", '"'}:
        return v[1:-1]
    return v


def _read_dotenv_value(*keys: str) -> str:
    """Read the data-dir knob before pydantic settings are built.

    The runtime overlay path itself depends on the data directory, so we need a
    tiny reader for XHS_DATA_DIR / DATA_DIR before BaseSettings loads the full
    config. OS environment still wins in _configured_data_dir().
    """
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return ""
    wanted = set(keys)
    try:
        for raw_line in env_path.read_text("utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() in wanted:
                return _strip_env_quotes(value)
    except Exception:
        return ""
    return ""


def _resolve_data_dir(value: str | None = None) -> Path:
    raw = _strip_env_quotes(value or "")
    if not raw:
        return (BASE_DIR / "data").resolve()
    expanded = os.path.expandvars(os.path.expanduser(raw))
    p = Path(expanded)
    if not p.is_absolute():
        p = BASE_DIR / p
    return p.resolve()


def _configured_data_dir() -> Path:
    # Preferred for production. Aliases keep hand-written deployment configs
    # working and let operators avoid storing runtime data under the git tree.
    for key in ("XHS_DATA_DIR", "XHS_AGENT_DATA_DIR", "DATA_DIR"):
        value = os.environ.get(key)
        if value:
            return _resolve_data_dir(value)
    return _resolve_data_dir(
        _read_dotenv_value("XHS_DATA_DIR", "XHS_AGENT_DATA_DIR", "DATA_DIR")
    )


DATA_DIR = _configured_data_dir()
OVERLAY_PATH = DATA_DIR / "settings.json"

_MUTABLE_KEYS = (
    # Legacy shared OpenAI-compatible config. Kept as fallback for old .env /
    # settings.json and old clients.
    "openai_api_key",
    "openai_base_url",
    # New split config: text/chat and image can use different gateways/keys.
    "chat_api_key",
    "chat_base_url",
    "image_api_key",
    "image_base_url",
    "chat_model",
    "image_model",
    # Public origin of this app when deployed, e.g. https://xhs.example.com.
    # If set, /static/images/... can be sent to model providers as absolute
    # URLs instead of being uploaded/inlined.
    "public_base_url",
)


def _mask_key(key: str) -> str:
    k = key or ""
    return (k[:6] + "…" + k[-4:]) if len(k) > 12 else ("已设置" if k else "")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    chat_api_key: str = ""
    chat_base_url: str = ""
    image_api_key: str = ""
    image_base_url: str = ""
    chat_model: str = "gpt-4o"
    image_model: str = "gpt-image-1"
    public_base_url: str = ""

    database_url: str = f"sqlite+aiosqlite:///{DATA_DIR / 'xhs_agent.db'}"
    image_dir: str = str(DATA_DIR / "images")
    port: int = 8787
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    jwt_secret: str = ""

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def effective_chat_api_key(self) -> str:
        return self.chat_api_key or self.openai_api_key

    @property
    def effective_chat_base_url(self) -> str:
        return self.chat_base_url or self.openai_base_url

    @property
    def effective_image_api_key(self) -> str:
        return self.image_api_key or self.chat_api_key or self.openai_api_key

    @property
    def effective_image_base_url(self) -> str:
        return self.image_base_url or self.chat_base_url or self.openai_base_url

    def public_dict(self) -> Dict[str, Any]:
        """What we expose via /api/settings. Mask the key."""
        chat_key = self.effective_chat_api_key
        image_key = self.effective_image_api_key
        return {
            # Backward-compatible aliases map to the text/chat config.
            "openai_api_key_mask": _mask_key(chat_key),
            "openai_api_key_set": bool(chat_key),
            "openai_base_url": self.effective_chat_base_url,
            # Split config.
            "chat_api_key_mask": _mask_key(chat_key),
            "chat_api_key_set": bool(chat_key),
            "chat_base_url": self.effective_chat_base_url,
            "image_api_key_mask": _mask_key(image_key),
            "image_api_key_set": bool(image_key),
            "image_base_url": self.effective_image_base_url,
            "chat_model": self.chat_model,
            "image_model": self.image_model,
            "public_base_url": self.public_base_url.rstrip("/"),
        }


_lock = threading.Lock()
_cached: Settings | None = None


def _is_legacy_data_path(value: str, tail: str) -> bool:
    raw = (value or "").strip().replace("\\", "/")
    if raw.startswith("./"):
        raw = raw[2:]
    return raw == f"data/{tail}"


def _normalize_sqlite_database_url(url: str) -> str:
    """Normalize sqlite URLs without letting cwd changes create a new DB.

    The historical default was sqlite+aiosqlite:///./data/xhs_agent.db. When a
    production data dir is configured, keep that familiar .env value working but
    redirect it to XHS_DATA_DIR so deploys can update code without touching data.
    Other custom relative sqlite paths remain anchored to backend/ for backward
    compatibility.
    """
    value = (url or "").strip()
    for prefix in ("sqlite+aiosqlite:///", "sqlite:///"):
        if not value.startswith(prefix):
            continue
        path_part = value[len(prefix):]
        if not path_part or path_part == ":memory:":
            return value
        if _is_legacy_data_path(path_part, "xhs_agent.db"):
            return prefix + str((DATA_DIR / "xhs_agent.db").resolve())
        p = Path(path_part)
        if p.is_absolute():
            return value
        return prefix + str((BASE_DIR / p).resolve())
    return value


def _normalize_runtime_paths(settings: Settings) -> Settings:
    settings.database_url = _normalize_sqlite_database_url(settings.database_url)
    if settings.image_dir:
        if _is_legacy_data_path(settings.image_dir, "images"):
            settings.image_dir = str((DATA_DIR / "images").resolve())
        elif not Path(settings.image_dir).is_absolute():
            settings.image_dir = str((BASE_DIR / settings.image_dir).resolve())
    return settings


def _load_overlay() -> Dict[str, Any]:
    if OVERLAY_PATH.exists():
        try:
            return json.loads(OVERLAY_PATH.read_text("utf-8"))
        except Exception:
            return {}
    return {}


def _apply_overlay(settings: Settings, overlay: Dict[str, Any]) -> None:
    for k, v in overlay.items():
        if k in _MUTABLE_KEYS and v is not None and (v != "" or k == "public_base_url"):
            setattr(settings, k, v)


def get_settings() -> Settings:
    global _cached
    with _lock:
        if _cached is None:
            s = Settings()
            _apply_overlay(s, _load_overlay())
            _normalize_runtime_paths(s)
            Path(s.image_dir).mkdir(parents=True, exist_ok=True)
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            _cached = s
        return _cached


def update_settings(patch: Dict[str, Any]) -> Settings:
    """Persist overlay, clear caches, rebuild client."""
    global _cached
    clean: Dict[str, Any] = {}
    for k in _MUTABLE_KEYS:
        if k in patch and patch[k] is not None:
            clean[k] = patch[k]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    overlay = _load_overlay()
    overlay.update(clean)
    OVERLAY_PATH.write_text(json.dumps(overlay, ensure_ascii=False, indent=2), "utf-8")
    with _lock:
        _cached = None
    # rebuild downstream clients
    from .services import llm as _llm
    _llm.reset_client()
    return get_settings()


async def get_effective_settings(user_id: int) -> Settings:
    """Return settings with user overrides applied if they opted in."""
    from .database import SessionLocal, UserSettings
    from sqlalchemy import select

    base = get_settings()
    async with SessionLocal() as s:
        result = await s.execute(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        us = result.scalars().first()

    if not us or not us.use_own_key:
        return base

    # Build a copy with user overrides
    effective = Settings()
    _apply_overlay(effective, _load_overlay())

    # Legacy per-user fields are still supported and act as shared fallback.
    if us.openai_api_key:
        effective.openai_api_key = us.openai_api_key
    if us.openai_base_url:
        effective.openai_base_url = us.openai_base_url
    if getattr(us, "chat_api_key", ""):
        effective.chat_api_key = us.chat_api_key
    if getattr(us, "chat_base_url", ""):
        effective.chat_base_url = us.chat_base_url
    if getattr(us, "image_api_key", ""):
        effective.image_api_key = us.image_api_key
    if getattr(us, "image_base_url", ""):
        effective.image_base_url = us.image_base_url
    if us.chat_model:
        effective.chat_model = us.chat_model
    if us.image_model:
        effective.image_model = us.image_model
    _normalize_runtime_paths(effective)
    return effective
