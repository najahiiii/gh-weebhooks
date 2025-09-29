"""the beautiful world start from here."""

from __future__ import annotations

from fastapi import FastAPI

from app.db import Base, engine
from app.routers import gh, info, tg, bots, stats

Base.metadata.create_all(engine)

app = FastAPI(title="GitHub → Telegram (multi-user, topics & channels)")

app.include_router(info.router)
app.include_router(tg.router)
app.include_router(gh.router)
app.include_router(bots.router)
app.include_router(stats.router)
