"""the beautiful world start from here."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.db import Base, SessionLocal, engine
from app.models import AdminSession
from app.routers import admin_ui, auth, bots, gh, info, stats, tg_sink
from app.timezone import TZ, now_wib

Base.metadata.create_all(engine)

app = FastAPI(title="GitHub → Telegram (multi-user, topics & channels)")

ASSETS_DIR = Path(__file__).resolve().parent / "assets"
app.mount("/static", StaticFiles(directory=str(ASSETS_DIR)), name="static")


class AdminSessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.user = None
        token = request.cookies.get(settings.session_cookie_name)
        if token:
            with SessionLocal() as db:
                session = (
                    db.query(AdminSession)
                    .filter(AdminSession.token == token)
                    .first()
                )
                if session:
                    current_time = now_wib()
                    raw_expires = session.expires_at
                    expires_at = None

                    if isinstance(raw_expires, datetime):
                        expires_at = (
                            raw_expires
                            if raw_expires.tzinfo
                            else raw_expires.replace(tzinfo=TZ)
                        )
                    elif isinstance(raw_expires, str):
                        try:
                            parsed = datetime.fromisoformat(raw_expires)
                        except ValueError:
                            parsed = None
                        if parsed:
                            expires_at = (
                                parsed
                                if parsed.tzinfo
                                else parsed.replace(tzinfo=TZ)
                            )
                            session.expires_at = expires_at
                            db.commit()
                        else:
                            expires_at = None
                    elif raw_expires is not None:
                        # Unexpected type: drop the session
                        expires_at = None

                    if not expires_at or expires_at <= current_time:
                        db.delete(session)
                        db.commit()
                    else:
                        user = session.user
                        request.state.user = SimpleNamespace(
                            id=user.id,
                            telegram_user_id=user.telegram_user_id,
                            username=user.username,
                            is_admin=user.is_admin,
                            session_token=session.token,
                        )
        response = await call_next(request)
        return response


app.add_middleware(AdminSessionMiddleware)

app.include_router(info.router)
app.include_router(auth.router)
app.include_router(admin_ui.router)
app.include_router(gh.router)
app.include_router(bots.router)
app.include_router(stats.router)
app.include_router(tg_sink.router)
