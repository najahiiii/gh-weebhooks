"""Ruter Ingfo?"""

from __future__ import annotations

from textwrap import dedent

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.config import settings
from app.utils import CMD_HELP

router = APIRouter()

HTTP_HELP_TEXT = dedent(
    f"""
GitHub → Telegram Notifier (HTTP Help)

Endpoints
---------
- GET  /            : Health check
- GET  /help        : Ringkasan perintah & endpoint
- GET  /setup       : Panduan setup end-to-end
- GET  /stats       : Statistik ringkas (butuh admin key bila dikonfigurasi)
- POST /tg/{{bot_id}}/{{token}} : Telegram webhook (per bot user)
- POST /wh/{{hook_id}}          : GitHub webhook (per subscription)

Perintah Telegram
-----------------
{CMD_HELP}

Catatan
-------
- PUBLIC_BASE_URL: {settings.public_base_url}
- Semua waktu disimpan dalam WIB (Asia/Jakarta).
"""
).strip()


def render_setup_text() -> str:
    """
    Seeeeeeetup
    """
    base = settings.public_base_url.rstrip("/")
    return dedent(
        f"""
    Setup Guide (Server & Webhook)

    1) ENV (.env)
    -------------
    DB_URL=sqlite:///./github_tg.sqlite3
    PUBLIC_BASE_URL={base}
    ADMIN_USER_IDS=123456789

    2) venv & deps
    --------------
    python -m venv .venv
    source .venv/bin/activate
    pip install -U pip
    pip install fastapi uvicorn httpx sqlalchemy pydantic python-dotenv

    3) Jalankan
    -----------
    uvicorn app.app:app --host 127.0.0.1 --port 8000 --workers=2 --proxy-headers --forwarded-allow-ips="*"

    4) Webhook Telegram
    -------------------
    {base}/tg/{{bot_id}}/{{token}}

    5) Webhook GitHub
    -----------------
    Payload URL: {base}/wh/{{hook_id}}
    Content type: application/json
    Secret: (dari /subscribe)
    """
    ).strip()


@router.get("/", response_class=PlainTextResponse)
def root():
    """
    Simple liveness endpoint.
    """
    return "Hello World!"


@router.get("/help", response_class=PlainTextResponse)
def http_help():
    """
    HTTP help endpoint.
    Returns a plaintext cheat sheet of endpoints and Telegram commands.
    """
    return HTTP_HELP_TEXT


@router.get("/setup", response_class=PlainTextResponse)
def http_setup():
    """
    HTTP setup endpoint.
    Returns a plaintext end-to-end setup guide.
    """
    return render_setup_text()
