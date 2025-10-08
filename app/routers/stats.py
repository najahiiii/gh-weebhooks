"""Ruter Stats?"""

from __future__ import annotations

from datetime import datetime
from textwrap import dedent
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User, Bot, Destination, Subscription

router = APIRouter(tags=["Stats"])


def _check_admin_key(key_from_request: Optional[str]) -> bool:
    admin_key = settings.admin_http_key
    if not admin_key:
        return True
    return (key_from_request or "") == admin_key


def _mask_generic(s: Optional[str], keep: int = 3) -> str:
    if not s:
        return "-"
    s = str(s)
    if len(s) <= keep:
        return "•" * len(s)
    return s[:keep] + "…"


def _mask_chat_id(chat_id: Optional[str]) -> str:
    if not chat_id:
        return "-"
    s = str(chat_id)
    # biarkan @username (publik), masker angka
    if s.startswith("@"):
        return s
    # jaga prefix -100 lalu tampilkan 4 digit terakhir
    if s.startswith("-100"):
        return "-100…" + s[-4:]
    if s.startswith("-"):
        return "-…" + s[-4:]
    return _mask_generic(s, keep=3)


@router.get("/stats", response_class=HTMLResponse)
def stats_page(
    key: Optional[str] = Query(None, alias="key"),
    db: Session = Depends(get_db),
):
    if not _check_admin_key(key):
        return HTMLResponse(
            "<h3>Forbidden</h3><p>Invalid admin key.</p>", status_code=403
        )

    total_users = db.query(User).count()
    total_bots = db.query(Bot).count()
    total_dests = db.query(Destination).count()
    total_subs = db.query(Subscription).count()

    # Ringkasan per-user
    users = db.query(User).order_by(User.first_seen_at.asc(), User.id.asc()).all()

    # Subscription terbaru (tanpa hook_id, token, bot_id)
    recent_subs = (
        db.query(Subscription).order_by(Subscription.created_at.desc()).limit(50).all()
    )

    def esc(s: str) -> str:
        # ringan, cukup ganti < & >
        return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    # HTML render
    summary_cards = [
        (
            "Users",
            total_users,
            "sky",
            "Total Telegram users that have interacted with the bridge.",
        ),
        (
            "Bots",
            total_bots,
            "violet",
            "Connected Telegram bots currently tracked by the service.",
        ),
        (
            "Destinations",
            total_dests,
            "emerald",
            "Distinct chats and topics receiving GitHub notifications.",
        ),
        (
            "Subscriptions",
            total_subs,
            "amber",
            "Active GitHub repositories forwarding events to Telegram.",
        ),
    ]

    summary_cards_html = "\n".join(
        [
            dedent(
                f"""
                <div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-lg shadow-slate-950/40">
                  <p class="text-sm font-medium uppercase tracking-wide text-{accent}-300">{title}</p>
                  <p class="mt-4 text-3xl font-semibold text-slate-100">{value}</p>
                  <p class="mt-2 text-sm text-slate-400">{description}</p>
                </div>
                """
            ).strip()
            for title, value, accent, description in summary_cards
        ]
    )

    user_rows = []
    for u in users:
        admin_badge = (
            "<span class=\"rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-200\">Admin</span>"
            if u.is_admin
            else "—"
        )
        user_rows.append(
            dedent(
                f"""
                <tr class="border-b border-slate-800/60 last:border-b-0">
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-slate-200">{esc(u.username or '-')}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm font-mono text-slate-300">{_mask_generic(u.telegram_user_id, keep=3)}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-slate-200">{admin_badge}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-slate-200">{len(u.bots)}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-slate-200">{len(u.destinations)}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-slate-200">{len(u.subs)}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{u.first_seen_at.strftime('%Y-%m-%d %H:%M')}</td>
                </tr>
                """
            ).strip()
        )

    user_rows_html = "\n".join(user_rows) or (
        "<tr><td colspan=\"7\" class=\"px-4 py-6 text-center text-sm text-slate-400\">No users yet.</td></tr>"
    )

    subscription_rows = []
    for s in recent_subs:
        owner = s.owner # engaged
        dest = s.destination
        topic_badge = (
            f"<span class=\"rounded-full border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-200\">topic:{dest.topic_id}</span>"
            if dest.topic_id
            else ""
        )
        subscription_rows.append(
            dedent(
                f"""
                <tr class="border-b border-slate-800/60 last:border-b-0">
                  <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-200">{esc(s.repo)}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm font-mono text-slate-300">{esc(s.events_csv or '*')}</td>
                  <td class="px-4 py-3 text-sm text-slate-200">
                    <div class="flex flex-wrap items-center gap-2">
                      <span>{esc(owner.username or '-')}</span>
                      <span class="rounded-full border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-xs font-mono text-slate-300">{_mask_generic(owner.telegram_user_id, keep=3)}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-sm text-slate-200">
                    <div class="flex flex-wrap items-center gap-2">
                      <span>{esc(dest.title or '-')}</span>
                      <span class="rounded-full border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-xs font-mono text-slate-300">{_mask_chat_id(dest.chat_id)}</span>
                      {topic_badge}
                    </div>
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{s.created_at.strftime('%Y-%m-%d %H:%M')}</td>
                </tr>
                """
            ).strip()
        )

    subscription_rows_html = "\n".join(subscription_rows) or (
        "<tr><td colspan=\"5\" class=\"px-4 py-6 text-center text-sm text-slate-400\">No subscriptions yet.</td></tr>"
    )

    html = dedent(
        f"""
        <!doctype html>
        <html lang="en" class="h-full bg-slate-950">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Stats · GitHub → Telegram Notifier</title>
            <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
          </head>
          <body class="h-full text-slate-100">
            <main class="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 py-16">
              <header class="max-w-3xl">
                <p class="text-sm font-semibold uppercase tracking-wide text-violet-300">Stats dashboard</p>
                <h1 class="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Usage insights</h1>
                <p class="mt-4 text-base text-slate-300 sm:text-lg">
                  Monitor bridge activity at a glance. Sensitive identifiers remain masked, and tokens,
                  bot IDs, and hook IDs are never exposed in this view.
                </p>
              </header>

              <section>
                <h2 class="sr-only">Summary metrics</h2>
                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {summary_cards_html}
                </div>
              </section>

              <section class="space-y-6">
                <div class="flex items-end justify-between gap-4">
                  <div>
                    <h2 class="text-2xl font-semibold text-slate-100">Users</h2>
                    <p class="mt-1 text-sm text-slate-400">Per-user breakdown including admin access and footprint.</p>
                  </div>
                </div>
                <div class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 shadow-lg shadow-slate-950/40">
                  <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-slate-800/80">
                      <thead class="bg-slate-900/50">
                        <tr>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">User</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Telegram (masked)</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Admin</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"># Bots</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"># Destinations</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"># Subscriptions</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">First seen</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-800/60">
                        {user_rows_html}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section class="space-y-6">
                <div class="flex items-end justify-between gap-4">
                  <div>
                    <h2 class="text-2xl font-semibold text-slate-100">Recent subscriptions</h2>
                    <p class="mt-1 text-sm text-slate-400">Latest 50 GitHub repositories connected through the bridge.</p>
                  </div>
                </div>
                <div class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 shadow-lg shadow-slate-950/40">
                  <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-slate-800/80">
                      <thead class="bg-slate-900/50">
                        <tr>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Repository</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Events</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Owner</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Destination</th>
                          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Created</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-800/60">
                        {subscription_rows_html}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <footer class="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                <span>&copy; {datetime.now().year} <a class="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline" href="https://github.com/najahiiii/gh-weebhooks">gh-weebhooks</a></span>
                <span class="flex items-center gap-3">
                  <a class="text-sky-300 transition hover:text-sky-200" href="/">Home</a>
                  <a class="text-sky-300 transition hover:text-sky-200" href="/help">Help</a>
                  <a class="text-sky-300 transition hover:text-sky-200" href="/setup">Setup</a>
                </span>
              </footer>
            </main>
          </body>
        </html>
        """
    )

    return HTMLResponse(html)
