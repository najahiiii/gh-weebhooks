"""Setup router to bootstrap the main Telegram bot via the web UI."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Form, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.services.bots import BotSetupError, register_bot

router = APIRouter(prefix="/setup", tags=["Setup"])

ADMIN_HTTP_KEY = settings.admin_http_key


def _check_admin_key(key_from_request: Optional[str]) -> bool:
    if not ADMIN_HTTP_KEY:
        return True
    return (key_from_request or "") == ADMIN_HTTP_KEY


def _render_form(error: str | None = None) -> str:
    base_placeholder = settings.public_base_url
    error_block = ""
    if error:
        error_block = f"""
          <div class="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </div>
        """
    return f"""<!doctype html>
<html lang="en" class="h-full bg-slate-950">
  <head>
    <meta charset="utf-8">
    <title>Setup Main Bot</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://cdn.tailwindcss.com?plugins=forms"></script>
  </head>
  <body class="h-full text-slate-100">
    <main class="flex min-h-screen items-center justify-center px-4 py-16">
      <div class="w-full max-w-xl rounded-3xl border border-slate-800/60 bg-slate-900/70 p-10 shadow-2xl shadow-slate-950/40 backdrop-blur">
        <div class="mb-6 space-y-2 text-center">
          <h1 class="text-3xl font-semibold tracking-tight text-slate-50">🚀 Setup Main Bot</h1>
          <p class="text-sm text-slate-400">
            Register the primary Telegram bot that users will interact with. We will store the token,
            ensure the owner is an admin, and call <code class="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200">setWebhook</code>.
          </p>
        </div>
        {error_block}
        <form method="post" class="space-y-5">
          <div>
            <label class="block text-sm font-medium text-slate-200">Admin HTTP Key (only if configured)</label>
            <input
              type="password"
              name="admin_key"
              placeholder="ADMIN_HTTP_KEY"
              class="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-4 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-200">Bot Token</label>
            <input
              type="text"
              name="token"
              placeholder="123456789:AAAbbbCCC"
              required
              class="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-4 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-200">Owner Telegram User ID</label>
            <input
              type="text"
              name="owner_tg_id"
              placeholder="e.g. 123456789"
              required
              class="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-4 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-200">Public Base URL</label>
            <input
              type="text"
              name="public_base_url"
              placeholder="{base_placeholder}"
              class="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-4 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
            >
          </div>
          <button
            type="submit"
            class="w-full rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:shadow-xl hover:shadow-sky-500/30 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
          >
            Save Bot &amp; Set Webhook
          </button>
        </form>
        <p class="mt-8 text-center text-xs text-slate-500">
          Prefer the older form? Visit <a href="/bots/new" class="text-sky-300 hover:text-sky-200">/bots/new</a>.
        </p>
      </div>
    </main>
  </body>
</html>"""


@router.get("/main-bot", response_class=HTMLResponse)
def setup_main_bot_form(key: Optional[str] = Query(None, alias="key")):
    if not _check_admin_key(key):
        return HTMLResponse(
            "<h3>Forbidden</h3><p>Invalid admin key.</p>",
            status_code=403,
        )
    return HTMLResponse(_render_form())


@router.post("/main-bot", response_class=HTMLResponse)
async def setup_main_bot_submit(
    token: str = Form(...),
    owner_tg_id: str = Form(...),
    public_base_url: Optional[str] = Form(None),
    admin_key: Optional[str] = Form(None),
    session: Session = Depends(get_db),
):
    if not _check_admin_key(admin_key):
        return HTMLResponse(
            _render_form("Invalid admin key."),
            status_code=403,
        )

    try:
        result = await register_bot(
            session,
            token,
            owner_tg_id,
            public_base_url=public_base_url,
        )
    except BotSetupError as exc:
        return HTMLResponse(
            _render_form(str(exc)),
            status_code=400,
        )

    status = 200 if result.webhook_result.get("ok") else 500
    webhook_url = f"{result.base_url}/tg/{result.bot_id}/{token}"
    info_link = f"/bots/info?token={token}"

    return HTMLResponse(
        f"""<!doctype html>
<html lang="en" class="h-full bg-slate-950">
  <head>
    <meta charset="utf-8">
    <title>Main Bot Ready</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
  </head>
  <body class="h-full text-slate-100">
    <main class="flex min-h-screen items-center justify-center px-4 py-16">
      <div class="w-full max-w-2xl rounded-3xl border border-slate-800/60 bg-slate-900/80 p-10 shadow-2xl shadow-slate-950/50 backdrop-blur">
        <div class="space-y-3">
          <h1 class="text-3xl font-semibold text-sky-300">✅ Main Bot Ready</h1>
          <p class="text-sm text-slate-400">
            The primary Telegram bot has been saved, the owner set as admin, and Telegram webhook configured.
          </p>
        </div>
        <dl class="mt-6 grid gap-4 rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 text-sm text-slate-300 md:grid-cols-2">
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Bot ID</dt>
            <dd class="mt-1 font-mono text-slate-100">{result.bot_id}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-500">Owner User ID</dt>
            <dd class="mt-1 font-mono text-slate-100">{result.owner_tg_id}</dd>
          </div>
          <div class="md:col-span-2">
            <dt class="text-xs uppercase tracking-wide text-slate-500">Webhook URL</dt>
            <dd class="mt-1 break-all rounded-xl bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-200">{webhook_url}</dd>
          </div>
        </dl>
        <section class="mt-8">
          <h2 class="text-sm font-semibold text-slate-200">setWebhook response</h2>
          <pre class="mt-3 max-h-80 overflow-auto rounded-2xl border border-slate-800/60 bg-slate-950/60 p-4 text-xs text-slate-300">{result.webhook_result}</pre>
        </section>
        <div class="mt-8 flex flex-wrap gap-3">
          <a href="{info_link}" class="flex-1 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-center text-sm font-medium text-sky-200 hover:bg-sky-500/20 sm:flex-none sm:px-5">
            Check getWebhookInfo
          </a>
          <a href="/setup/main-bot" class="flex-1 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 text-center text-sm font-medium text-indigo-200 hover:bg-indigo-500/20 sm:flex-none sm:px-5">
            Register another bot
          </a>
          <a href="/" class="flex-1 rounded-xl border border-slate-700/60 bg-slate-800/80 px-4 py-3 text-center text-sm font-medium text-slate-200 hover:bg-slate-800 sm:flex-none sm:px-5">
            Back to homepage
          </a>
        </div>
        <p class="mt-6 text-xs text-slate-500">
          Next step: talk to your bot on Telegram and send <code class="rounded bg-slate-800 px-1.5 py-0.5 text-[0.7rem] text-slate-200">/start</code> to begin using the in-chat menu.
        </p>
      </div>
    </main>
  </body>
</html>""",
        status_code=status,
    )
