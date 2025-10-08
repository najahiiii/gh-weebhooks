"""the beautiful world start from here."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.db import Base, SessionLocal, engine
from app.models import AdminSession
from app.routers import auth, bots, gh, info, setup, stats, tg
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
                current_time = now_wib()
                if session and session.expires_at:
                    expires_at = (
                        session.expires_at
                        if session.expires_at.tzinfo
                        else session.expires_at.replace(tzinfo=TZ)
                    )
                else:
                    expires_at = None

                if session and expires_at and expires_at > current_time:
                    user = session.user
                    request.state.user = SimpleNamespace(
                        id=user.id,
                        telegram_user_id=user.telegram_user_id,
                        username=user.username,
                        is_admin=user.is_admin,
                        session_token=session.token,
                    )
                elif session:
                    db.delete(session)
                    db.commit()
        response = await call_next(request)
        return response


app.add_middleware(AdminSessionMiddleware)

app.include_router(info.router)
app.include_router(auth.router)
app.include_router(tg.router)
app.include_router(gh.router)
app.include_router(bots.router)
app.include_router(setup.router)
app.include_router(stats.router)
