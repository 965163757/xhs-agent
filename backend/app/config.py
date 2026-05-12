"""Runtime settings: .env defaults + overlay persisted at data/settings.json.

Frontend can edit API key / base url / models on the fly; we write overlay to
settings.json, reload, and let services/llm rebuild its client.
"""
from __future__ import annotations

import json
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
OVERLAY_PATH = DATA_DIR / "settings.json"

_MUTABLE_KEYS = ("openai_api_key", "openai_base_url", "chat_model", "image_model")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    chat_model: str = "gpt-4o"
    image_model: str = "gpt-image-1"

    database_url: str = f"sqlite+aiosqlite:///{DATA_DIR / 'xhs_agent.db'}"
    image_dir: str = str(DATA_DIR / "images")
    port: int = 8787
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    jwt_secret: str = ""

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def public_dict(self) -> Dict[str, Any]:
        """What we expose via /api/settings. Mask the key."""
        k = self.openai_api_key or ""
        masked = (k[:6] + "…" + k[-4:]) if len(k) > 12 else ("已设置" if k else "")
        return {
            "openai_api_key_mask": masked,
            "openai_api_key_set": bool(k),
            "openai_base_url": self.openai_base_url,
            "chat_model": self.chat_model,
            "image_model": self.image_model,
        }


_lock = threading.Lock()
_cached: Settings | None = None


def _load_overlay() -> Dict[str, Any]:
    if OVERLAY_PATH.exists():
        try:
            return json.loads(OVERLAY_PATH.read_text("utf-8"))
        except Exception:
            return {}
    return {}


def _apply_overlay(settings: Settings, overlay: Dict[str, Any]) -> None:
    for k, v in overlay.items():
        if k in _MUTABLE_KEYS and v is not None and v != "":
            setattr(settings, k, v)


def get_settings() -> Settings:
    global _cached
    with _lock:
        if _cached is None:
            s = Settings()
            _apply_overlay(s, _load_overlay())
            Path(s.image_dir).mkdir(parents=True, exist_ok=True)
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            _cached = s
        return _cached


def update_settings(patch: Dict[str, Any]) -> Settings:
    """Persist overlay, clear caches, rebuild client."""
    global _cached
    clean: Dict[str, Any] = {}
    for k in _MUTABLE_KEYS:
        if k in patch and patch[k] is not None and patch[k] != "":
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
