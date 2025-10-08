"""Ruter BOTS?"""

from typing import Optional

from fastapi import APIRouter, Depends, Form, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.services.bots import BotSetupError, register_bot
from app.services.telegram import get_webhook_info
from app.templating import templates

router = APIRouter(tags=["Bots"])

ADMIN_HTTP_KEY = settings.admin_http_key


def _has_session_admin(request: Request) -> bool:
    user = getattr(request.state, "user", None)
    return bool(user and getattr(user, "is_admin", False))


def _check_admin_key(key_from_request: Optional[str]) -> bool:
    if not ADMIN_HTTP_KEY:
        return True
    return (key_from_request or "") == ADMIN_HTTP_KEY


def _error_template(request: Request, title: str, message: str, *, status_code: int):
    return templates.TemplateResponse(
        "errors/message.html",
        {
            "request": request,
            "title": title,
            "message": message,
            "page_description": message,
            "status_code": status_code,
        },
        status_code=status_code,
    )


@router.get("/bots/new", response_class=HTMLResponse)
def new_bot_form(request: Request, key: Optional[str] = Query(None, alias="key")):
    if not _has_session_admin(request):
        if not _check_admin_key(key):
            if key:
                return _error_template(
                    request,
                    "Forbidden",
                    "Invalid admin key.",
                    status_code=403,
                )
            login_url = request.url_for("auth_login") + f"?next={request.url.path}"
            return RedirectResponse(login_url, status_code=303)

    return templates.TemplateResponse(
        "bots/new.html",
        {
            "request": request,
            "page_title": "Add Telegram Bot",
            "page_description": "Register a Telegram bot token, assign an owner, and configure the webhook for GitHub updates.",
            "admin_key_required": bool(ADMIN_HTTP_KEY) and not _has_session_admin(request),
            "base_placeholder": settings.public_base_url,
            "form_action": request.url_for("add_bot"),
        },
    )


@router.post("/bots/add", response_class=HTMLResponse)
async def add_bot(
    request: Request,
    token: str = Form(...),
    owner_tg_id: str = Form(...),
    public_base_url: Optional[str] = Form(None),
    admin_key: Optional[str] = Form(None),
    session: Session = Depends(get_db),
):
    if not _has_session_admin(request):
        if not _check_admin_key(admin_key):
            return _error_template(
                request,
                "Forbidden",
                "Please login as an admin or provide a valid admin key.",
                status_code=403,
            )

    try:
        setup_result = await register_bot(
            session,
            token,
            owner_tg_id,
            public_base_url=public_base_url,
        )
    except BotSetupError as exc:
        return _error_template(request, "Invalid data", str(exc), status_code=400)

    info_link = request.url_for("bot_info")
    webhook_url = f"{setup_result.base_url}/tg/{setup_result.bot_id}/{token}"
    status_code = 200 if setup_result.webhook_result.get("ok") else 500

    return templates.TemplateResponse(
        "bots/saved.html",
        {
            "request": request,
            "page_title": f"Bot {setup_result.bot_id} saved",
            "page_description": "Telegram bot token stored and webhook configured for GitHub → Telegram delivery.",
            "bot_id": setup_result.bot_id,
            "owner_tg_id": owner_tg_id,
            "webhook_url": webhook_url,
            "webhook_result": setup_result.webhook_result,
            "info_link": f"{info_link}?token={token}",
        },
        status_code=status_code,
    )


@router.get("/bots/info", response_class=HTMLResponse)
async def bot_info(
    request: Request,
    token: str,
    key: Optional[str] = Query(None, alias="key"),
):
    if not _has_session_admin(request):
        if not _check_admin_key(key):
            if key:
                return _error_template(
                    request,
                    "Forbidden",
                    "Invalid admin key.",
                    status_code=403,
                )
            login_url = request.url_for("auth_login") + f"?next={request.url.path}"
            return RedirectResponse(login_url, status_code=303)

    result = await get_webhook_info(token)
    return templates.TemplateResponse(
        "bots/info.html",
        {
            "request": request,
            "page_title": "Telegram getWebhookInfo",
            "page_description": "Inspect the current webhook configuration returned by Telegram for this bot token.",
            "token": token,
            "result": result,
        },
    )
