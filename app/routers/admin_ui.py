"""Admin web UI for managing bots, destinations, and subscriptions."""

from __future__ import annotations

from typing import Optional
from uuid import uuid4
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import Bot, Destination, Subscription, User
from app.services.telegram import (
    HTTP_TIMEOUT_SHORT_SECONDS,
    TELEGRAM_API_BASE,
    set_telegram_webhook,
)
from app.templating import templates
from app.utils import parse_bot_id_from_token

router = APIRouter(prefix="/admin", tags=["admin-ui"])


def _get_db() -> Session:
    return SessionLocal()


_BOT_USERNAME_CACHE: dict[int, str] = {}


_NOTICE_MESSAGES: dict[str, str] = {
    "bot_deleted": "Bot removed. Existing webhooks will no longer reach this service.",
    "bot_token_updated": "Bot token updated and webhook refreshed.",
    "destination_updated": "Destination settings saved.",
    "subscription_updated": "Subscription updated.",
}

_ERROR_MESSAGES: dict[str, str] = {
    "bot_has_subs": "Remove subscriptions linked to this bot before deleting it.",
    "bot_token_invalid": "Provide a valid Telegram bot token.",
    "bot_token_mismatch": "The supplied token belongs to a different bot.",
    "bot_webhook_failed": "Token saved, but refreshing the Telegram webhook failed. Check the logs.",
    "destination_invalid_chat": "Chat ID is required to update a destination.",
    "destination_topic_invalid": "Topic ID must be numeric.",
    "subscription_invalid_repo": "Repository must be in the owner/repo format.",
    "subscription_destination_missing": "Selected destination was not found.",
    "subscription_bot_missing": "Selected bot was not found.",
}


def _redirect_with_feedback(
    request: Request,
    endpoint: str,
    *,
    notice: Optional[str] = None,
    error: Optional[str] = None,
) -> RedirectResponse:
    params: dict[str, str] = {}
    if notice:
        params["notice"] = notice
    if error:
        params["error"] = error
    url = str(request.url_for(endpoint))
    if params:
        url = f"{url}?{urlencode(params)}"
    return RedirectResponse(url=url, status_code=303)


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


def _require_account(request: Request, db: Session) -> User:
    state_user = getattr(request.state, "user", None)
    if not state_user:
        raise HTTPException(403, "Login required")
    user = db.query(User).filter(User.id == state_user.id).first()
    if not user:
        raise HTTPException(403, "Account not found")
    return user


@router.get("/dashboard", response_class=HTMLResponse, name="admin_dashboard")
def admin_dashboard(request: Request):
    with _get_db() as db:
        account = _require_account(request, db)
        bots = (
            db.query(Bot)
            .filter(Bot.owner_user_id == account.id)
            .order_by(Bot.created_at.desc())
            .all()
        )
        destinations_count = (
            db.query(Destination).filter(Destination.owner_user_id == account.id).count()
        )
        subscriptions_count = (
            db.query(Subscription).filter(Subscription.owner_user_id == account.id).count()
        )
        notice_code = request.query_params.get("notice")
        error_code = request.query_params.get("error")
        return templates.TemplateResponse(
            "admin/dashboard.html",
            {
                "request": request,
                "bots": bots,
                "destinations_count": destinations_count,
                "subscriptions_count": subscriptions_count,
                "public_base_url": settings.public_base_url.rstrip("/"),
                "notice_message": _NOTICE_MESSAGES.get(notice_code or ""),
                "error_message": _ERROR_MESSAGES.get(error_code or ""),
                "admin_http_key": settings.admin_http_key,
            },
        )


@router.post("/bots/{bot_id}/delete", name="admin_delete_bot")
def delete_bot(request: Request, bot_id: int):
    bot_cache_key: Optional[int] = None
    with _get_db() as db:
        account = _require_account(request, db)
        bot = (
            db.query(Bot)
            .filter(Bot.id == bot_id, Bot.owner_user_id == account.id)
            .first()
        )
        if not bot:
            raise HTTPException(404, "Bot not found.")
        if bot.subs:
            return _redirect_with_feedback(
                request, "admin_dashboard", error="bot_has_subs"
            )
        bot_cache_key = bot.id
        db.delete(bot)
        db.commit()

    if bot_cache_key is not None:
        _BOT_USERNAME_CACHE.pop(bot_cache_key, None)
    return _redirect_with_feedback(request, "admin_dashboard", notice="bot_deleted")


@router.post("/bots/{bot_id}/token", name="admin_update_bot_token")
async def update_bot_token(request: Request, bot_id: int, token: str = Form(...)):
    token_value = (token or "").strip()
    if not token_value:
        return _redirect_with_feedback(
            request, "admin_dashboard", error="bot_token_invalid"
        )
    parsed_bot_id = parse_bot_id_from_token(token_value)
    if not parsed_bot_id:
        return _redirect_with_feedback(
            request, "admin_dashboard", error="bot_token_invalid"
        )

    bot_cache_key: Optional[int] = None
    with _get_db() as db:
        account = _require_account(request, db)
        bot = (
            db.query(Bot)
            .filter(Bot.id == bot_id, Bot.owner_user_id == account.id)
            .first()
        )
        if not bot:
            raise HTTPException(404, "Bot not found.")
        if bot.bot_id != parsed_bot_id:
            return _redirect_with_feedback(
                request, "admin_dashboard", error="bot_token_mismatch"
            )
        bot.token = token_value
        bot_cache_key = bot.id
        db.commit()

    if bot_cache_key is not None:
        _BOT_USERNAME_CACHE.pop(bot_cache_key, None)

    webhook_failed = False
    try:
        await set_telegram_webhook(token_value, parsed_bot_id, settings.public_base_url)
    except HTTPException:
        webhook_failed = True

    if webhook_failed:
        return _redirect_with_feedback(
            request,
            "admin_dashboard",
            notice="bot_token_updated",
            error="bot_webhook_failed",
        )
    return _redirect_with_feedback(
        request,
        "admin_dashboard",
        notice="bot_token_updated",
    )


@router.get("/destinations", response_class=HTMLResponse, name="admin_destinations")
def destinations_page(request: Request):
    with _get_db() as db:
        account = _require_account(request, db)
        destinations = (
            db.query(Destination)
            .filter(Destination.owner_user_id == account.id)
            .order_by(Destination.id.desc())
            .all()
        )
        notice_code = request.query_params.get("notice")
        error_code = request.query_params.get("error")
        return templates.TemplateResponse(
            "admin/destinations.html",
            {
                "request": request,
                "destinations": destinations,
                "notice_message": _NOTICE_MESSAGES.get(notice_code or ""),
                "error_message": _ERROR_MESSAGES.get(error_code or ""),
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
        account = _require_account(request, db)
        destination = Destination(
            owner_user_id=account.id,
            chat_id=chat_id,
            title=title,
            topic_id=topic_value,
            is_default=False,
        )
        if is_default:
            db.query(Destination).filter(
                Destination.owner_user_id == account.id,
                Destination.is_default.is_(True),
            ).update({"is_default": False})
            destination.is_default = True

        db.add(destination)
        db.commit()

    return RedirectResponse(
        url=str(request.url_for("admin_destinations")), status_code=303
    )


@router.post(
    "/destinations/{destination_id}/edit", name="admin_edit_destination"
)
def edit_destination(
    request: Request,
    destination_id: int,
    chat_id: str = Form(...),
    title: str = Form(""),
    topic_id: str = Form(""),
    is_default: Optional[str] = Form(None),
):
    chat_value = (chat_id or "").strip()
    if not chat_value:
        return _redirect_with_feedback(
            request, "admin_destinations", error="destination_invalid_chat"
        )
    title_value = (title or "").strip()
    topic_value: Optional[int] = None
    topic_str = (topic_id or "").strip()
    if topic_str:
        try:
            topic_value = int(topic_str)
        except ValueError:
            return _redirect_with_feedback(
                request, "admin_destinations", error="destination_topic_invalid"
            )

    with _get_db() as db:
        account = _require_account(request, db)
        destination = (
            db.query(Destination)
            .filter(
                Destination.id == destination_id,
                Destination.owner_user_id == account.id,
            )
            .first()
        )
        if not destination:
            raise HTTPException(404, "Destination not found.")

        destination.chat_id = chat_value
        destination.title = title_value
        destination.topic_id = topic_value

        if is_default:
            db.query(Destination).filter(
                Destination.owner_user_id == account.id,
                Destination.is_default.is_(True),
            ).update({"is_default": False})
            destination.is_default = True

        db.commit()

    return _redirect_with_feedback(
        request, "admin_destinations", notice="destination_updated"
    )


@router.post(
    "/destinations/{destination_id}/default", name="admin_set_destination_default"
)
def set_default_destination(request: Request, destination_id: int):
    with _get_db() as db:
        account = _require_account(request, db)
        destination = (
            db.query(Destination)
            .filter(
                Destination.id == destination_id,
                Destination.owner_user_id == account.id,
            )
            .first()
        )
        if not destination:
            raise HTTPException(404, "Destination not found.")

        db.query(Destination).filter(
            Destination.owner_user_id == account.id,
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
        account = _require_account(request, db)
        destination = (
            db.query(Destination)
            .filter(
                Destination.id == destination_id,
                Destination.owner_user_id == account.id,
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
        account = _require_account(request, db)
        subscriptions = (
            db.query(Subscription)
            .filter(Subscription.owner_user_id == account.id)
            .order_by(Subscription.created_at.desc())
            .all()
        )
        destinations = (
            db.query(Destination)
            .filter(Destination.owner_user_id == account.id)
            .order_by(Destination.id.desc())
            .all()
        )
        bots = (
            db.query(Bot)
            .filter(Bot.owner_user_id == account.id)
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
                    "destination_id": sub.destination_id,
                    "bot_id": sub.bot_id,
                }
            )
        notice_code = request.query_params.get("notice")
        error_code = request.query_params.get("error")
        return templates.TemplateResponse(
            "admin/subscriptions.html",
            {
                "request": request,
                "subscription_rows": subscription_rows,
                "destinations": destinations,
                "bot_options": bot_options,
                "public_base_url": base_url,
                "notice_message": _NOTICE_MESSAGES.get(notice_code or ""),
                "error_message": _ERROR_MESSAGES.get(error_code or ""),
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
        account = _require_account(request, db)
        destination = (
            db.query(Destination)
            .filter(
                Destination.id == destination_id,
                Destination.owner_user_id == account.id,
            )
            .first()
        )
        if not destination:
            raise HTTPException(404, "Destination not found.")

        bot = (
            db.query(Bot)
            .filter(Bot.id == bot_id, Bot.owner_user_id == account.id)
            .first()
        )
        if not bot:
            raise HTTPException(404, "Bot not found.")

        hook_id = uuid4().hex
        secret = uuid4().hex

        subscription = Subscription(
            owner_user_id=account.id,
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
    "/subscriptions/{subscription_id}/edit", name="admin_edit_subscription"
)
def edit_subscription(
    request: Request,
    subscription_id: int,
    repo: str = Form(...),
    events: str = Form(""),
    destination_id: int = Form(...),
    bot_id: int = Form(...),
):
    repo_value = (repo or "").strip()
    if "/" not in repo_value:
        return _redirect_with_feedback(
            request, "admin_subscriptions", error="subscription_invalid_repo"
        )
    events_csv = (events or "").strip() or "*"

    with _get_db() as db:
        account = _require_account(request, db)
        subscription = (
            db.query(Subscription)
            .filter(
                Subscription.id == subscription_id,
                Subscription.owner_user_id == account.id,
            )
            .first()
        )
        if not subscription:
            raise HTTPException(404, "Subscription not found.")

        destination = (
            db.query(Destination)
            .filter(
                Destination.id == destination_id,
                Destination.owner_user_id == account.id,
            )
            .first()
        )
        if not destination:
            return _redirect_with_feedback(
                request, "admin_subscriptions", error="subscription_destination_missing"
            )

        bot = (
            db.query(Bot)
            .filter(Bot.id == bot_id, Bot.owner_user_id == account.id)
            .first()
        )
        if not bot:
            return _redirect_with_feedback(
                request, "admin_subscriptions", error="subscription_bot_missing"
            )

        subscription.repo = repo_value
        subscription.events_csv = events_csv
        subscription.destination_id = destination.id
        subscription.bot_id = bot.id
        db.commit()

    return _redirect_with_feedback(
        request, "admin_subscriptions", notice="subscription_updated"
    )


@router.post(
    "/subscriptions/{subscription_id}/delete", name="admin_delete_subscription"
)
def delete_subscription(request: Request, subscription_id: int):
    with _get_db() as db:
        account = _require_account(request, db)
        subscription = (
            db.query(Subscription)
            .filter(
                Subscription.id == subscription_id,
                Subscription.owner_user_id == account.id,
            )
            .first()
        )
        if subscription:
            db.delete(subscription)
            db.commit()

    return RedirectResponse(
        url=str(request.url_for("admin_subscriptions")), status_code=303
    )
