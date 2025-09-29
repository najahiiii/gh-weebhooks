"""Ruter Stats?"""

from __future__ import annotations

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
    html = [
        "<!doctype html><html><head><meta charset='utf-8'><title>Stats</title>",
        "<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:24px}"
        "table{border-collapse:collapse;width:100%;margin:12px 0}"
        "th,td{border:1px solid #ddd;padding:8px;font-size:14px}"
        "th{background:#fafafa;text-align:left}"
        "small{color:#666}"
        ".pill{display:inline-block;padding:2px 8px;border:1px solid #ddd;border-radius:999px;font-size:12px;margin-left:6px}"
        "</style></head><body>",
    ]

    html += [
        "<h1>GitHub → Telegram — Statistik</h1>",
        "<p><small>Halaman ini tidak menampilkan token, bot_id, atau hook_id.</small></p>",
        "<h2>Ringkasan</h2>",
        "<ul>",
        f"<li>Total Users: <b>{total_users}</b></li>",
        f"<li>Total Bots: <b>{total_bots}</b></li>",
        f"<li>Total Destinations: <b>{total_dests}</b></li>",
        f"<li>Total Subscriptions: <b>{total_subs}</b></li>",
        "</ul>",
    ]

    html += [
        "<h2>Per-User</h2>",
        "<table><thead><tr>",
        "<th>User</th><th>Telegram (masked)</th><th>Admin</th><th>#Bots</th><th>#Destinations</th><th>#Subscriptions</th><th>First Seen</th>",
        "</tr></thead><tbody>",
    ]
    for u in users:
        html += [
            "<tr>",
            f"<td>{esc(u.username or '-')}</td>",
            f"<td>{_mask_generic(u.telegram_user_id, keep=3)}</td>",
            f"<td>{'✅' if u.is_admin else '—'}</td>",
            f"<td>{len(u.bots)}</td>",
            f"<td>{len(u.destinations)}</td>",
            f"<td>{len(u.subs)}</td>",
            f"<td><small>{u.first_seen_at.strftime('%Y-%m-%d %H:%M')}</small></td>",
            "</tr>",
        ]
    html += ["</tbody></table>"]

    html += [
        "<h2>Subscriptions Terbaru</h2>",
        "<table><thead><tr>",
        "<th>Repo</th><th>Events</th><th>Owner</th><th>Destination</th><th>Created</th>",
        "</tr></thead><tbody>",
    ]
    for s in recent_subs:
        owner = s.owner  # relationship
        dest = s.destination
        html += [
            "<tr>",
            f"<td>{esc(s.repo)}</td>",
            f"<td><code>{esc(s.events_csv or '*')}</code></td>",
            f"<td>{esc(owner.username or '-')} <span class='pill'>{_mask_generic(owner.telegram_user_id, keep=3)}</span></td>",
            f"<td>{esc(dest.title or '-')} <span class='pill'>{_mask_chat_id(dest.chat_id)}</span>"
            + (
                f" <span class='pill'>topic:{dest.topic_id}</span>"
                if dest.topic_id
                else ""
            )
            + "</td>",
            f"<td><small>{s.created_at.strftime('%Y-%m-%d %H:%M')}</small></td>",
            "</tr>",
        ]
    html += ["</tbody></table>"]

    html += [
        "<p><a href='/help'>Help</a> • <a href='/setup'>Setup</a></p>",
        "</body></html>",
    ]

    return HTMLResponse("".join(html))
