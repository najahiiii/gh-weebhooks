"""Ruter Ingfo?"""

from __future__ import annotations

from datetime import datetime
from textwrap import dedent

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.config import settings
from app.timezone import TZ_NAME
from app.templating import templates
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
- Semua waktu disimpan dalam zona waktu {TZ_NAME}.
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
    TIMEZONE={TZ_NAME}

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


@router.get("/", response_class=HTMLResponse)
def root(request: Request):
    """Render a simple Tailwind-powered landing page for the service."""

    page_title = "GitHub → Telegram Notifier"
    page_description = (
        "Bridge GitHub webhooks into Telegram chats with multi-user, multi-bot support."
    )
    return templates.TemplateResponse(
        "info/index.html",
        {
            "request": request,
            "page_title": page_title,
            "page_description": page_description,
            "year": datetime.now().year,
            "help_text": HTTP_HELP_TEXT,
            "setup_text": render_setup_text(),
        },
    )


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
