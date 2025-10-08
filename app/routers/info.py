"""Ruter Ingfo?"""

from __future__ import annotations

from datetime import datetime
from textwrap import dedent

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, PlainTextResponse

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


@router.get("/", response_class=HTMLResponse)
def root():
    """Render a simple Tailwind-powered landing page for the service."""

    return dedent(
        """
        <!doctype html>
        <html lang="en" class="h-full bg-slate-950">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>GitHub → Telegram Notifier</title>
            <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
          </head>
          <body class="h-full text-slate-100">
            <main class="flex min-h-screen flex-col items-center justify-center gap-12 px-6 py-16">
              <header class="max-w-2xl text-center">
                <p class="text-sm font-semibold uppercase tracking-wide text-sky-300">Webhook bridge</p>
                <h1 class="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">GitHub → Telegram</h1>
                <p class="mt-4 text-base text-slate-300 sm:text-lg">
                  Receive GitHub notifications directly in Telegram chats. Explore the docs below to
                  learn how to configure hooks, automate updates, and monitor delivery statistics.
                </p>
              </header>

              <section class="grid w-full max-w-4xl gap-6 sm:grid-cols-3">
                <a
                  href="/help"
                  class="group rounded-xl border border-slate-800 bg-slate-900/40 p-6 shadow-lg shadow-slate-950/40
                         transition hover:border-sky-400 hover:bg-slate-900/70"
                >
                  <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-slate-100">HTTP Help</h2>
                    <span class="text-sky-300 transition group-hover:text-sky-200">→</span>
                  </div>
                  <p class="mt-3 text-sm text-slate-400">
                    Browse the available REST endpoints and Telegram bot commands supported by the
                    service.
                  </p>
                </a>

                <a
                  href="/setup"
                  class="group rounded-xl border border-slate-800 bg-slate-900/40 p-6 shadow-lg shadow-slate-950/40
                         transition hover:border-emerald-400 hover:bg-slate-900/70"
                >
                  <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-slate-100">Setup Guide</h2>
                    <span class="text-emerald-300 transition group-hover:text-emerald-200">→</span>
                  </div>
                  <p class="mt-3 text-sm text-slate-400">
                    Follow the end-to-end instructions to configure environment variables, webhooks,
                    and deployment.
                  </p>
                </a>

                <a
                  href="/stats"
                  class="group rounded-xl border border-slate-800 bg-slate-900/40 p-6 shadow-lg shadow-slate-950/40
                         transition hover:border-fuchsia-400 hover:bg-slate-900/70"
                >
                  <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-slate-100">Delivery Stats</h2>
                    <span class="text-fuchsia-300 transition group-hover:text-fuchsia-200">→</span>
                  </div>
                  <p class="mt-3 text-sm text-slate-400">
                    Inspect current webhook usage, delivery counts, and health metrics (admin access
                    may be required).
                  </p>
                </a>
              </section>

              <footer class="text-xs text-slate-500">
                &copy; {year} <a href="https://github.com/najahiiii/gh-weebhooks">gh-weebhooks</a>.
              </footer>
            </main>
          </body>
        </html>
        """
    ).format(year=datetime.now().year)


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
