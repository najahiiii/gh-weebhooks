"""Ruter Stats?"""

from __future__ import annotations

from datetime import datetime
from textwrap import dedent
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User, Bot, Destination, Subscription
from app.templating import templates

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
            login_url = request.url_for("auth_login") + f"?next={request.url.path}"
            return RedirectResponse(login_url, status_code=303)

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

    summary = {
        "users": total_users,
        "bots": total_bots,
        "destinations": total_dests,
        "subscriptions": total_subs,
    }

    user_rows = [
        {
            "username": user.username or "-",
            "telegram_masked": _mask_generic(user.telegram_user_id, keep=3),
            "is_admin": user.is_admin,
            "bots": len(user.bots),
            "destinations": len(user.destinations),
            "subscriptions": len(user.subs),
            "first_seen": user.first_seen_at.strftime("%Y-%m-%d %H:%M"),
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
                "created_at": sub.created_at.strftime("%Y-%m-%d %H:%M"),
            }
        )

    return templates.TemplateResponse(
        "stats/index.html",
        {
            "request": request,
            "page_title": "Stats Dashboard",
            "page_description": "Review users, bots, destinations, and recent GitHub subscriptions across the GitHub → Telegram bridge.",
            "summary": summary,
            "user_rows": user_rows,
            "subscription_rows": subscription_rows,
        },
    )
