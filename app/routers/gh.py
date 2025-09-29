"""Ruter GH?"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Bot, Destination, Subscription
from app.services.github import summarize_event
from app.services.telegram import send_message
from app.utils import gh_verify

router = APIRouter(prefix="/wh", tags=["github"])


@router.post("/{hook_id}", response_class=PlainTextResponse)
async def github_webhook(
    hook_id: str,
    request: Request,
    x_hub_signature_256: str | None = Header(None),
    x_github_event: str | None = Header(None),
):
    """
    GitHub webhook endpoint.

    The `hook_id` identifies a Subscription row containing the expected HMAC `secret`
    and the (bot, destination) pair to forward notifications to. The payload signature
    is validated against `X-Hub-Signature-256`.
    """
    body = await request.body()
    db: Session = SessionLocal()
    sub = db.query(Subscription).filter_by(hook_id=hook_id).first()
    if not sub:
        raise HTTPException(404, "Hook tidak ditemukan")

    if not gh_verify(sub.secret, body, x_hub_signature_256):
        raise HTTPException(401, "Signature tidak valid")

    payload = await request.json()
    event = x_github_event or "unknown"

    if sub.events_csv and sub.events_csv != "*":
        allowed = [e.strip() for e in sub.events_csv.split(",") if e.strip()]
        if event not in allowed:
            return "ignored"

    bot = db.query(Bot).filter_by(id=sub.bot_id).first()
    dest = db.query(Destination).filter_by(id=sub.destination_id).first()
    if not bot or not dest:
        raise HTTPException(500, "Bot atau destination tidak tersedia")

    text = summarize_event(event, payload)
    await send_message(bot.token, dest.chat_id, text, topic_id=dest.topic_id)
    return "ok"
