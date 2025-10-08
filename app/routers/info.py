"""Ruter Ingfo?"""

from __future__ import annotations

from datetime import datetime
from html import escape
from string import Template
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

    help_text = escape(HTTP_HELP_TEXT)
    setup_text = escape(render_setup_text())

    needs_stats_key = bool(settings.admin_http_key)

    if needs_stats_key:
        stats_button = dedent(
            """
            <button
              type="button"
              data-open-modal="stats-key"
              class="group rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-left shadow-lg shadow-slate-950/40
                     transition hover:border-violet-400 hover:bg-slate-900/70 focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-2 focus-visible:outline-violet-400"
            >
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-semibold text-slate-100">Stats</h2>
                <span class="text-violet-300 transition group-hover:text-violet-200">→</span>
              </div>
              <p class="mt-3 text-sm text-slate-400">
                View aggregate usage insights after providing the required admin key.
              </p>
            </button>
            """
        ).strip()
    else:
        stats_button = dedent(
            """
            <a
              href="/stats"
              class="group rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-left shadow-lg shadow-slate-950/40
                     transition hover:border-violet-400 hover:bg-slate-900/70 focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-2 focus-visible:outline-violet-400"
            >
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-semibold text-slate-100">Stats</h2>
                <span class="text-violet-300 transition group-hover:text-violet-200">→</span>
              </div>
              <p class="mt-3 text-sm text-slate-400">
                Explore aggregated usage metrics for users, bots, and destinations.
              </p>
            </a>
            """
        ).strip()


    stats_modal_html = (
        dedent(
            """
            <div
              id="modal-stats-key"
              class="fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/80 px-4 py-10"
              role="dialog"
              aria-modal="true"
            >
              <div class="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/60">
                <div class="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-4">
                  <h3 class="text-lg font-semibold text-slate-100">Enter Admin Key</h3>
                  <button
                    type="button"
                    class="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200"
                    data-close-modal
                    aria-label="Close Stats Access"
                  >
                    ✕
                  </button>
                </div>
                <form class="space-y-4 bg-slate-950/60 px-6 py-6" action="/stats" method="get">
                  <p class="text-sm text-slate-300">Provide the configured admin key to access the statistics dashboard.</p>
                  <label class="block text-sm font-medium text-slate-200" for="stats-key-input">
                    Admin key
                    <input
                      id="stats-key-input"
                      name="key"
                      type="password"
                      required
                      class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40"
                      placeholder="Paste admin key"
                      data-initial-focus
                    />
                  </label>
                  <div class="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      class="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                      data-close-modal
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      class="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
                    >
                      View stats
                    </button>
                  </div>
                </form>
              </div>
            </div>
            """
        ).strip()
        if needs_stats_key
        else ""
    )
    
    
    stats_modal_map_entries = (
        "                ['stats-key', document.getElementById('modal-stats-key')],\n"
        if needs_stats_key
        else ""
    )

    template = Template(
        dedent(
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

              <section class="grid w-full max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <button
                  type="button"
                  data-open-modal="help"
                  class="group rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-left shadow-lg shadow-slate-950/40
                         transition hover:border-sky-400 hover:bg-slate-900/70 focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-slate-100">HTTP Help</h2>
                    <span class="text-sky-300 transition group-hover:text-sky-200">→</span>
                  </div>
                  <p class="mt-3 text-sm text-slate-400">
                    Browse the available REST endpoints and Telegram bot commands supported by the
                    service.
                  </p>
                </button>

                <button
                  type="button"
                  data-open-modal="setup"
                  class="group rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-left shadow-lg shadow-slate-950/40
                         transition hover:border-emerald-400 hover:bg-slate-900/70 focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                >
                  <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-slate-100">Setup Guide</h2>
                    <span class="text-emerald-300 transition group-hover:text-emerald-200">→</span>
                  </div>
                  <p class="mt-3 text-sm text-slate-400">
                    Follow the end-to-end instructions to configure environment variables, webhooks,
                    and deployment.
                  </p>
                </button>

                $stats_button
              </section>

              <footer class="text-xs text-slate-500">
                &copy; $year <a href="https://github.com/najahiiii/gh-weebhooks">gh-weebhooks</a>.
              </footer>
            </main>

            <div
              id="modal-help"
              class="fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/80 px-4 py-10"
              role="dialog"
              aria-modal="true"
            >
              <div class="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/60">
                <div class="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-4">
                  <h3 class="text-lg font-semibold text-slate-100">HTTP Help</h3>
                  <button
                    type="button"
                    class="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200"
                    data-close-modal
                    aria-label="Close HTTP Help"
                  >
                    ✕
                  </button>
                </div>
                <div class="max-h-[70vh] overflow-y-auto bg-slate-950/60 px-6 py-6">
                  <pre class="whitespace-pre-wrap text-sm text-slate-200">$help_text</pre>
                </div>
              </div>
            </div>

            <div
              id="modal-setup"
              class="fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/80 px-4 py-10"
              role="dialog"
              aria-modal="true"
            >
              <div class="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/60">
                <div class="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-4">
                  <h3 class="text-lg font-semibold text-slate-100">Setup Guide</h3>
                  <button
                    type="button"
                    class="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-200"
                    data-close-modal
                    aria-label="Close Setup Guide"
                  >
                    ✕
                  </button>
                </div>
                <div class="max-h-[70vh] overflow-y-auto bg-slate-950/60 px-6 py-6">
                  <pre class="whitespace-pre-wrap text-sm text-slate-200">$setup_text</pre>
                </div>
              </div>
            </div>

            $stats_modal

            <script>
              const body = document.body;
              const openButtons = document.querySelectorAll('[data-open-modal]');
              const modals = new Map([
                ['help', document.getElementById('modal-help')],
                ['setup', document.getElementById('modal-setup')],
$stats_modal_map_entries
              ]);

              function openModal(key) {
                const modal = modals.get(key);
                if (!modal) return;
                modal.classList.remove('hidden');
                modal.classList.add('flex');
                body.classList.add('overflow-hidden');
                const closeButton = modal.querySelector('[data-close-modal]');
                const initialFocus = modal.querySelector('[data-initial-focus]');
                if (initialFocus) {
                  initialFocus.focus();
                } else {
                  closeButton?.focus();
                }
              }

              function closeModal(modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                body.classList.remove('overflow-hidden');
              }

              openButtons.forEach((button) => {
                button.addEventListener('click', () => {
                  openModal(button.dataset.openModal);
                });
              });

              document.querySelectorAll('[data-close-modal]').forEach((button) => {
                button.addEventListener('click', () => {
                  const modal = button.closest('[role="dialog"]');
                  if (modal) {
                    closeModal(modal);
                  }
                });
              });

              modals.forEach((modal) => {
                modal.addEventListener('click', (event) => {
                  if (event.target === modal) {
                    closeModal(modal);
                  }
                });
              });

              window.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                  modals.forEach((modal) => {
                    if (!modal.classList.contains('hidden')) {
                      closeModal(modal);
                    }
                  });
                }
              });
            </script>
          </body>
        </html>
        """
        )
    )

    return template.substitute(
        year=datetime.now().year,
        help_text=help_text,
        setup_text=setup_text,
        stats_button=stats_button,
        stats_modal=stats_modal_html,
        stats_modal_map_entries=stats_modal_map_entries,
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
