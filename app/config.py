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
    timezone: str = os.getenv("TIMEZONE", "Asia/Jakarta")
    admin_ids: frozenset[str] = frozenset(
        s.strip() for s in os.getenv("ADMIN_USER_IDS", "").split(",") if s.strip()
    )
    admin_http_key: str = os.getenv("ADMIN_HTTP_KEY", "supersecret-admin-key")
    login_bot_token: str = os.getenv("LOGIN_BOT_TOKEN", "")
    login_bot_username: str = os.getenv("LOGIN_BOT_USERNAME", "")
    session_cookie_name: str = os.getenv("SESSION_COOKIE_NAME", "gh_admin_session")
    session_duration_hours: int = int(os.getenv("SESSION_DURATION_HOURS", "24"))


settings = Settings()
