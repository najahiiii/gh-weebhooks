"""Timezone helpers."""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import settings

DEFAULT_TIMEZONE = "Asia/Jakarta"


def _load_timezone(name: str, fallback: str = DEFAULT_TIMEZONE) -> tuple[ZoneInfo, str]:
    """Return a ``ZoneInfo`` instance and its canonical name with a fallback."""

    try:
        return ZoneInfo(name), name
    except ZoneInfoNotFoundError:
        return ZoneInfo(fallback), fallback


TZ, TZ_NAME = _load_timezone(settings.timezone or DEFAULT_TIMEZONE)


def now_local() -> dt.datetime:
    """Current timezone-aware datetime in the configured timezone."""


def now_wib() -> dt.datetime:
    """Backward-compatible alias for :func:`now_local`."""

    return now_local()
