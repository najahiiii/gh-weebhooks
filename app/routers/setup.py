"""Setup router to bootstrap the main Telegram bot via the web UI."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Form, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.services.bots import BotSetupError, register_bot
from app.templating import templates

router = APIRouter(prefix="/setup", tags=["Setup"])

ADMIN_HTTP_KEY = settings.admin_http_key


def _check_admin_key(key_from_request: Optional[str]) -> bool:
    if not ADMIN_HTTP_KEY:
        return True
    return (key_from_request or "") == ADMIN_HTTP_KEY


def _has_session_admin(request: Request) -> bool:
    user = getattr(request.state, "user", None)
    return bool(user and getattr(user, "is_admin", False))


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


@router.get("/main-bot", response_class=HTMLResponse)
def setup_main_bot_form(
    request: Request,
    key: Optional[str] = Query(None, alias="key"),
):
    if not _has_session_admin(request):
        if not _check_admin_key(key):
            if key:
                return _error_template(request, "Forbidden", "Invalid admin key.", status_code=403)
            login_url = request.url_for("auth_login") + f"?next={request.url.path}"
            return RedirectResponse(login_url, status_code=303)

    return templates.TemplateResponse(
        "setup/main_bot.html",
        {
            "request": request,
            "page_title": "Setup Main Bot",
            "page_description": "Connect the primary Telegram bot and configure its webhook in one step.",
            "base_placeholder": settings.public_base_url,
            "admin_key_required": bool(ADMIN_HTTP_KEY) and not _has_session_admin(request),
        },
    )


@router.post("/main-bot", response_class=HTMLResponse)
async def setup_main_bot_submit(
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
        result = await register_bot(
            session,
            token,
            owner_tg_id,
            public_base_url=public_base_url,
        )
    except BotSetupError as exc:
        return templates.TemplateResponse(
            "setup/main_bot.html",
            {
                "request": request,
                "page_title": "Setup Main Bot",
                "page_description": "Connect the primary Telegram bot and configure its webhook in one step.",
                "base_placeholder": settings.public_base_url,
                "admin_key_required": bool(ADMIN_HTTP_KEY) and not _has_session_admin(request),
                "error": str(exc),
            },
            status_code=400,
        )

    status = 200 if result.webhook_result.get("ok") else 500
    webhook_url = f"{result.base_url}/tg/{result.bot_id}/{token}"

    return templates.TemplateResponse(
        "setup/main_bot_success.html",
        {
            "request": request,
            "page_title": "Main Bot Ready",
            "page_description": "Primary Telegram bot saved and webhook configured for GitHub notifications.",
            "bot_id": result.bot_id,
            "owner_tg_id": result.owner_tg_id,
            "webhook_url": webhook_url,
            "webhook_result": result.webhook_result,
            "info_link": request.url_for("bot_info") + f"?token={token}",
        },
        status_code=status,
    )
