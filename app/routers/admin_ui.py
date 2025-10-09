"""Admin web UI for managing bots, destinations, and subscriptions."""

from __future__ import annotations

from typing import Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import Bot, Destination, Subscription, User
from app.services.telegram import HTTP_TIMEOUT_SHORT_SECONDS, TELEGRAM_API_BASE
from app.templating import templates

router = APIRouter(prefix="/admin", tags=["admin-ui"])


def _get_db() -> Session:
    return SessionLocal()


_BOT_USERNAME_CACHE: dict[int, str] = {}


def _fetch_bot_username(token: str) -> Optional[str]:
    if not token:
        return None
    url = f"{TELEGRAM_API_BASE}/bot{token}/getMe"
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT_SHORT_SECONDS) as client:
            resp = client.get(url)
        data = resp.json()
        if resp.status_code >= 300 or not data.get("ok"):
            return None
        username = data.get("result", {}).get("username")
        if username:
            return f"@{username}" if not username.startswith("@") else username
        name = data.get("result", {}).get("first_name")
        return name
    except Exception:  # pragma: no cover - network failures are non-fatal
        return None


def _bot_display(bot: Bot) -> str:
    cached = _BOT_USERNAME_CACHE.get(bot.id)
    if cached is not None:
        return cached or bot.bot_id or "unknown"
    username = _fetch_bot_username(bot.token)
    label = username or bot.bot_id or "unknown"
    _BOT_USERNAME_CACHE[bot.id] = username or ""
    return label


def _require_admin(request: Request, db: Session) -> User:
    state_user = getattr(request.state, "user", None)
    if not state_user or not getattr(state_user, "is_admin", False):
        raise HTTPException(403, "Admin login required")
    user = db.query(User).filter(User.id == state_user.id).first()
    if not user:
        raise HTTPException(403, "Admin user not found")
    return user


@router.get("/dashboard", response_class=HTMLResponse, name="admin_dashboard")
def admin_dashboard(request: Request):
    with _get_db() as db:
        admin = _require_admin(request, db)
        bots = (
            db.query(Bot)
            .filter(Bot.owner_user_id == admin.id)
            .order_by(Bot.created_at.desc())
            .all()
        )
        destinations_count = (
            db.query(Destination).filter(Destination.owner_user_id == admin.id).count()
        )
        subscriptions_count = (
            db.query(Subscription).filter(Subscription.owner_user_id == admin.id).count()
        )
        return templates.TemplateResponse(
            "admin/dashboard.html",
            {
                "request": request,
                "bots": bots,
                "destinations_count": destinations_count,
                "subscriptions_count": subscriptions_count,
                "public_base_url": settings.public_base_url.rstrip("/"),
            },
        )


@router.get("/destinations", response_class=HTMLResponse, name="admin_destinations")
def destinations_page(request: Request):
    with _get_db() as db:
        admin = _require_admin(request, db)
        destinations = (
            db.query(Destination)
            .filter(Destination.owner_user_id == admin.id)
            .order_by(Destination.id.desc())
            .all()
        )
        return templates.TemplateResponse(
            "admin/destinations.html",
            {
                "request": request,
                "destinations": destinations,
            },
        )


@router.post("/destinations", name="admin_create_destination")
def create_destination(
    request: Request,
    chat_id: str = Form(...),
    title: str = Form(""),
    topic_id: str = Form(""),
    is_default: Optional[str] = Form(None),
):
    chat_id = (chat_id or "").strip()
    if not chat_id:
        raise HTTPException(400, "Chat ID is required.")
    title = (title or "").strip()
    topic_value: Optional[int] = None
    if topic_id:
        try:
            topic_value = int(topic_id.strip())
        except ValueError:
            topic_value = None

    with _get_db() as db:
        admin = _require_admin(request, db)
        destination = Destination(
            owner_user_id=admin.id,
            chat_id=chat_id,
            title=title,
            topic_id=topic_value,
            is_default=False,
        )
        if is_default:
            db.query(Destination).filter(
                Destination.owner_user_id == admin.id,
                Destination.is_default.is_(True),
            ).update({"is_default": False})
            destination.is_default = True

        db.add(destination)
        db.commit()

    return RedirectResponse(
        url=str(request.url_for("admin_destinations")), status_code=303
    )


@router.post(
    "/destinations/{destination_id}/default", name="admin_set_destination_default"
)
def set_default_destination(request: Request, destination_id: int):
    with _get_db() as db:
        admin = _require_admin(request, db)
        destination = (
            db.query(Destination)
            .filter(
                Destination.id == destination_id,
                Destination.owner_user_id == admin.id,
            )
            .first()
        )
        if not destination:
            raise HTTPException(404, "Destination not found.")

        db.query(Destination).filter(
            Destination.owner_user_id == admin.id,
            Destination.is_default.is_(True),
        ).update({"is_default": False})
        destination.is_default = True
        db.commit()

    return RedirectResponse(
        url=str(request.url_for("admin_destinations")), status_code=303
    )


@router.post(
    "/destinations/{destination_id}/delete", name="admin_delete_destination"
)
def delete_destination(request: Request, destination_id: int):
    with _get_db() as db:
        admin = _require_admin(request, db)
        destination = (
            db.query(Destination)
            .filter(
                Destination.id == destination_id,
                Destination.owner_user_id == admin.id,
            )
            .first()
        )
        if destination:
            if destination.subs:
                return RedirectResponse(
                    url=str(request.url_for("admin_destinations")), status_code=303
                )
            db.delete(destination)
            db.commit()

    return RedirectResponse(
        url=str(request.url_for("admin_destinations")), status_code=303
    )


@router.get("/subscriptions", response_class=HTMLResponse, name="admin_subscriptions")
def subscriptions_page(request: Request):
    with _get_db() as db:
        admin = _require_admin(request, db)
        subscriptions = (
            db.query(Subscription)
            .filter(Subscription.owner_user_id == admin.id)
            .order_by(Subscription.created_at.desc())
            .all()
        )
        destinations = (
            db.query(Destination)
            .filter(Destination.owner_user_id == admin.id)
            .order_by(Destination.id.desc())
            .all()
        )
        bots = (
            db.query(Bot)
            .filter(Bot.owner_user_id == admin.id)
            .order_by(Bot.created_at.desc())
            .all()
        )
        base_url = settings.public_base_url.rstrip("/")

        bot_options = []
        for bot in bots:
            label = _bot_display(bot)
            select_label = f"{label} ({bot.bot_id})" if label else bot.bot_id
            bot_options.append({"id": bot.id, "label": select_label})

        subscription_rows = []
        for sub in subscriptions:
            dest_label = (
                sub.destination.title or sub.destination.chat_id
                if sub.destination
                else "missing destination"
            )
            bot_label = _bot_display(sub.bot) if sub.bot else "unknown"
            subscription_rows.append(
                {
                    "id": sub.id,
                    "repo": sub.repo,
                    "events": sub.events_csv or "*",
                    "destination": dest_label,
                    "bot_label": bot_label,
                    "payload_url": f"{base_url}/wh/{sub.hook_id}",
                    "secret": sub.secret,
                }
            )
        return templates.TemplateResponse(
            "admin/subscriptions.html",
            {
                "request": request,
                "subscription_rows": subscription_rows,
                "destinations": destinations,
                "bot_options": bot_options,
                "public_base_url": base_url,
            },
        )


@router.post("/subscriptions", name="admin_create_subscription")
def create_subscription(
    request: Request,
    repo: str = Form(...),
    events: str = Form(""),
    destination_id: int = Form(...),
    bot_id: int = Form(...),
):
    repo = (repo or "").strip()
    if "/" not in repo:
        raise HTTPException(400, "Repository must be in owner/repo format.")
    events_csv = (events or "").strip() or "*"

    with _get_db() as db:
        admin = _require_admin(request, db)
        destination = (
            db.query(Destination)
            .filter(
                Destination.id == destination_id,
                Destination.owner_user_id == admin.id,
            )
            .first()
        )
        if not destination:
            raise HTTPException(404, "Destination not found.")

        bot = (
            db.query(Bot)
            .filter(Bot.id == bot_id, Bot.owner_user_id == admin.id)
            .first()
        )
        if not bot:
            raise HTTPException(404, "Bot not found.")

        hook_id = uuid4().hex
        secret = uuid4().hex

        subscription = Subscription(
            owner_user_id=admin.id,
            hook_id=hook_id,
            secret=secret,
            repo=repo,
            events_csv=events_csv,
            bot_id=bot.id,
            destination_id=destination.id,
        )
        db.add(subscription)
        db.commit()

    return RedirectResponse(
        url=str(request.url_for("admin_subscriptions")), status_code=303
    )


@router.post(
    "/subscriptions/{subscription_id}/delete", name="admin_delete_subscription"
)
def delete_subscription(request: Request, subscription_id: int):
    with _get_db() as db:
        admin = _require_admin(request, db)
        subscription = (
            db.query(Subscription)
            .filter(
                Subscription.id == subscription_id,
                Subscription.owner_user_id == admin.id,
            )
            .first()
        )
        if subscription:
            db.delete(subscription)
            db.commit()

    return RedirectResponse(
        url=str(request.url_for("admin_subscriptions")), status_code=303
    )
