"""Auth router handling Telegram-based admin login."""

from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import AdminSession, User
from app.services.auth import verify_telegram_login
from app.services.users import ensure_user_by_tg_id
from app.templating import templates
from app.timezone import now_wib

router = APIRouter(prefix="/auth", tags=["auth"])


class TelegramLoginPayload(BaseModel):
    id: int
    auth_date: int
    hash: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None


def _get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _clean_next_path(next_path: Optional[str]) -> str:
    if not next_path:
        return "/"
    if not next_path.startswith("/"):
        return "/"
    # prevent open redirect
    if next_path.startswith("//"):
        return "/"
    return next_path


def _build_redirect(next_path: str) -> JSONResponse:
    return JSONResponse({"ok": True, "redirect_to": next_path})


def _set_session_cookie(response: JSONResponse, token: str) -> None:
    max_age = settings.session_duration_hours * 3600
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=max_age,
        expires=max_age,
        httponly=True,
        secure=settings.public_base_url.startswith("https://"),
        samesite="lax",
    )


def _create_session(db: Session, user: User) -> AdminSession:
    token = secrets.token_urlsafe(48)
    expires_at = now_wib() + timedelta(hours=settings.session_duration_hours)

    # purge old sessions for this user to avoid clutter
    db.query(AdminSession).filter(
        AdminSession.user_id == user.id, AdminSession.expires_at < now_wib()
    ).delete()

    session = AdminSession(user_id=user.id, token=token, expires_at=expires_at)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/login", response_class=HTMLResponse, name="auth_login")
def login_page(request: Request, next: Optional[str] = None):
    next_path = _clean_next_path(next)
    if not settings.login_bot_token or not settings.login_bot_username:
        return templates.TemplateResponse(
            "auth/login.html",
            {
                "request": request,
                "login_disabled": True,
                "reason": "LOGIN_BOT_TOKEN or LOGIN_BOT_USERNAME not configured.",
                "next_path": next_path,
            },
        )

    if getattr(request.state, "user", None) and request.state.user.is_admin:
        # already logged in
        return RedirectResponse(next_path, status_code=303)

    return templates.TemplateResponse(
        "auth/login.html",
        {
            "request": request,
            "login_disabled": False,
            "bot_username": settings.login_bot_username,
            "next_path": next_path,
        },
    )


@router.post("/verify", response_class=JSONResponse, name="auth_verify")
def verify_login(
    request: Request,
    payload: TelegramLoginPayload,
    next: Optional[str] = None,
    db: Session = Depends(_get_db),
):
    if not settings.login_bot_token:
        raise HTTPException(503, "Telegram login not configured.")

    data = payload.model_dump()
    if not verify_telegram_login(data, settings.login_bot_token):
        raise HTTPException(400, "Invalid Telegram login payload.")

    user = ensure_user_by_tg_id(db, str(payload.id))
    # sync username if provided
    if payload.username and user.username != payload.username:
        user.username = payload.username
        db.commit()

    if not user.is_admin and str(payload.id) in settings.admin_ids:
        user.is_admin = True
        db.commit()

    if not user.is_admin:
        raise HTTPException(403, "You are not registered as an admin.")

    session = _create_session(db, user)

    next_path = _clean_next_path(next)
    response = _build_redirect(next_path)
    _set_session_cookie(response, session.token)
    return response


@router.post("/logout", name="auth_logout")
def logout(request: Request, db: Session = Depends(_get_db)):
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        db.query(AdminSession).filter(AdminSession.token == token).delete()
        db.commit()

    response = RedirectResponse(url=request.url_for("root"), status_code=303)
    response.delete_cookie(settings.session_cookie_name)
    return response
