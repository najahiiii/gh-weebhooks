"""Ruter Stats?"""

from __future__ import annotations

from datetime import datetime
from textwrap import dedent
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User, Bot, Destination, Subscription, WebhookEventLog
from app.templating import templates
from app.timezone import TZ

router = APIRouter(tags=["Stats"])


def _check_admin_key(key_from_request: Optional[str]) -> bool:
    admin_key = settings.admin_http_key
    if not admin_key:
        return True
    return (key_from_request or "") == admin_key


def _has_session_admin(request: Request) -> bool:
    user = getattr(request.state, "user", None)
    return bool(user and getattr(user, "is_admin", False))


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


def _fmt_dt(value: Optional[datetime]) -> str:
    if not value:
        return "-"
    if value.tzinfo:
        return value.astimezone(TZ).strftime("%Y-%m-%d %H:%M")
    return value.strftime("%Y-%m-%d %H:%M")


@router.get("/stats", response_class=HTMLResponse)
def stats_page(
    request: Request,
    key: Optional[str] = Query(None, alias="key"),
    db: Session = Depends(get_db),
):
    if not _has_session_admin(request):
        if not _check_admin_key(key):
            if key:
                return templates.TemplateResponse(
                    "errors/message.html",
                    {
                        "request": request,
                        "title": "Forbidden",
                        "message": "Invalid admin key.",
                        "page_description": "This dashboard requires a valid admin login or key.",
                        "status_code": 403,
                    },
                    status_code=403,
                )
            login_url = str(request.url_for("auth_login")) + f"?next={request.url.path}"
            return RedirectResponse(login_url, status_code=303)

    total_users = db.query(User).count()
    total_bots = db.query(Bot).count()
    total_dests = db.query(Destination).count()
    total_subs = db.query(Subscription).count()
    total_events = db.query(WebhookEventLog).count()

    # Ringkasan per-user
    users = db.query(User).order_by(User.first_seen_at.asc(), User.id.asc()).all()

    # Subscription terbaru (tanpa hook_id, token, bot_id)
    recent_subs = (
        db.query(Subscription).order_by(Subscription.created_at.desc()).limit(50).all()
    )

    summary = {
        "users": total_users,
        "bots": total_bots,
        "destinations": total_dests,
        "subscriptions": total_subs,
        "events": total_events,
    }

    user_rows = [
        {
            "username": user.username or "-",
            "telegram_masked": _mask_generic(user.telegram_user_id, keep=3),
            "is_admin": user.is_admin,
            "bots": len(user.bots),
            "destinations": len(user.destinations),
            "subscriptions": len(user.subs),
            "first_seen": _fmt_dt(user.first_seen_at),
        }
        for user in users
    ]

    subscription_rows = []
    for sub in recent_subs:
        owner = sub.owner
        dest = sub.destination
        subscription_rows.append(
            {
                "repo": sub.repo,
                "events": sub.events_csv or "*",
                "owner_username": owner.username or "-",
                "owner_masked": _mask_generic(owner.telegram_user_id, keep=3),
                "destination_title": dest.title or "-",
                "destination_masked": _mask_chat_id(dest.chat_id),
                "topic_id": dest.topic_id,
                "created_at": _fmt_dt(sub.created_at),
            }
        )

    recent_events = (
        db.query(WebhookEventLog)
        .order_by(WebhookEventLog.created_at.desc())
        .limit(50)
        .all()
    )

    status_badges = {
        "success": "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
        "error": "border-red-500/40 bg-red-500/10 text-red-100",
        "ignored": "border-slate-600/40 bg-slate-800/70 text-slate-200",
    }

    event_rows = [
        {
            "created_at": _fmt_dt(log.created_at),
            "event_type": log.event_type or "-",
            "repository": log.repository or "-",
            "status_label": (log.status or "unknown").title(),
            "status_class": status_badges.get(
                (log.status or "").lower(),
                "border-slate-700/50 bg-slate-900/70 text-slate-200",
            ),
            "summary_html": log.summary or "",
            "error": log.error_message,
        }
        for log in recent_events
    ]

    return templates.TemplateResponse(
        "stats/index.html",
        {
            "request": request,
            "page_title": "Stats Dashboard",
            "page_description": "Review users, bots, destinations, and recent GitHub activity across the GitHub → Telegram bridge.",
            "summary": summary,
            "user_rows": user_rows,
            "subscription_rows": subscription_rows,
            "event_rows": event_rows,
        },
    )
