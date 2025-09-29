"""the beautiful world start from here."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    """App Settings"""

    db_url: str = os.getenv("DB_URL", "sqlite:///./github_tg.sqlite3")
    public_base_url: str = os.getenv("PUBLIC_BASE_URL", "https://yourdomain.exe")
    admin_ids: frozenset[str] = frozenset(
        s.strip() for s in os.getenv("ADMIN_USER_IDS", "").split(",") if s.strip()
    )


settings = Settings()
