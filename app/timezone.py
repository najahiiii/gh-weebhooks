"""app timezone"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Jakarta")


def now_wib() -> dt.datetime:
    """Current timezone-aware datetime in WIB (Asia/Jakarta, UTC+7)."""
    return dt.datetime.now(tz=TZ)
