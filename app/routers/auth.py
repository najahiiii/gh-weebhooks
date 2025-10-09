"""Auth router handling Telegram-based login for the web UI."""

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
    try:
        duration_hours = float(settings.session_duration_hours)
    except (TypeError, ValueError):
        duration_hours = 24.0

    base_time = now_wib()
    if base_time is None:
        raise RuntimeError("Timezone helper now_wib() returned None")

    expires_at = base_time + timedelta(hours=duration_hours)

    # purge old sessions for this user to avoid clutter
    db.query(AdminSession).filter(
        AdminSession.user_id == user.id, AdminSession.expires_at < now_wib()
    ).delete()

    session = AdminSession(user_id=user.id, token=token, expires_at=expires_at)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _auth_page_context(
    request: Request,
    *,
    next_path: str,
    page_mode: str,
) -> dict:
    is_register = page_mode == "register"
    page_title = "Create Account" if is_register else "Sign In"
    hero_title = "Register" if is_register else "Sign in"
    hero_description = (
        "Connect your GitHub repositories to Telegram destinations."
        if is_register
        else "Manage your Telegram bots, destinations, and GitHub subscriptions."
    )
    note_text = (
        "Use your Telegram account to create a profile for this service."
        if is_register
        else "Use your Telegram account to access your workspace."
    )
    extra_hint = (
        "Already joined? "
        "<a href=\"{login_url}\" class=\"text-sky-300 hover:text-sky-200\">Sign in here</a>."
    ).format(login_url=request.url_for("auth_login")) if is_register else None

    return {
        "request": request,
        "login_disabled": not settings.login_bot_token or not settings.login_bot_username,
        "bot_username": settings.login_bot_username,
        "next_path": next_path,
        "page_mode": page_mode,
        "page_title": f"{page_title} · GitHub → Telegram",
        "page_description": hero_description,
        "hero_title": hero_title,
        "hero_description": hero_description,
        "note_text": note_text,
        "extra_hint": extra_hint,
    }


@router.get("/login", response_class=HTMLResponse, name="auth_login")
def login_page(request: Request, next: Optional[str] = None):
    next_path = _clean_next_path(next)
    current_user = getattr(request.state, "user", None)
    if current_user:
        target = (
            next_path
            if next is not None
            else str(request.url_for("admin_dashboard"))
        )
        return RedirectResponse(target, status_code=303)

    context = _auth_page_context(
        request,
        next_path=next_path,
        page_mode="login",
    )
    if context["login_disabled"]:
        context["reason"] = "LOGIN_BOT_TOKEN or LOGIN_BOT_USERNAME not configured."
    return templates.TemplateResponse("auth/login.html", context)


@router.get("/register", response_class=HTMLResponse, name="auth_register")
def register_page(request: Request, next: Optional[str] = None):
    cleaned_next = _clean_next_path(next)
    next_path = (
        str(request.url_for("admin_dashboard"))
        if next is None
        else cleaned_next
    )
    current_user = getattr(request.state, "user", None)
    if current_user:
        return RedirectResponse(next_path, status_code=303)

    context = _auth_page_context(
        request,
        next_path=next_path,
        page_mode="register",
    )
    if context["login_disabled"]:
        context["reason"] = "LOGIN_BOT_TOKEN atau LOGIN_BOT_USERNAME belum dikonfigurasi."
    return templates.TemplateResponse("auth/login.html", context)


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
