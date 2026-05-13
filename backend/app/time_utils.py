"""Application-wide time helpers.

The product is China-facing, so all user-visible timestamps should be
Beijing time (Asia/Shanghai, UTC+08:00).  SQLite's CURRENT_TIMESTAMP is UTC,
which made freshly-created rows look 8 hours behind in the UI.  We keep the
database values as naive Beijing local time for SQLite compatibility and
serialize API responses with an explicit +08:00 offset.
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo


APP_TIME_ZONE = "Asia/Shanghai"
APP_TZ = ZoneInfo(APP_TIME_ZONE)


def beijing_now() -> datetime:
    """Current aware datetime in Asia/Shanghai."""
    return datetime.now(APP_TZ)


def beijing_now_naive() -> datetime:
    """Current Beijing time without tzinfo, suitable for SQLite DateTime."""
    return beijing_now().replace(tzinfo=None)


def utc_now_iso() -> str:
    """Current UTC timestamp, useful for tokens/internal protocol work."""
    return datetime.now(timezone.utc).isoformat()


def beijing_now_iso() -> str:
    """Current Beijing timestamp with explicit +08:00 offset."""
    return beijing_now().isoformat(timespec="seconds")


def to_beijing(dt: datetime | None) -> datetime | None:
    """Normalize a datetime to aware Beijing time.

    Naive datetimes in this app are treated as Beijing local time.  This
    matches the ORM defaults and avoids browser/host timezone ambiguity.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=APP_TZ)
    return dt.astimezone(APP_TZ)


def beijing_iso(dt: datetime | None) -> str | None:
    value = to_beijing(dt)
    return value.isoformat(timespec="seconds") if value else None


def beijing_date_key(dt: datetime | None) -> str:
    value = to_beijing(dt)
    return value.strftime("%Y-%m-%d") if value else "unknown"


def parse_beijing_datetime_to_naive(value: str) -> datetime:
    """Parse user input as Beijing time and return naive Beijing datetime.

    - Naive input such as ``2026-05-13T09:00:00`` is interpreted as Beijing.
    - Offset-aware input is converted to Beijing before storing.
    """
    raw = (value or "").strip()
    if not raw:
        raise ValueError("empty datetime")
    normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=None)
    return dt.astimezone(APP_TZ).replace(tzinfo=None)
