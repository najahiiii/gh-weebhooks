"""Ruter GH?"""

from __future__ import annotations

import json

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.db import SessionLocal
from app.models import Bot, Destination, Subscription, WebhookEventLog
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
    with SessionLocal() as db:
        sub = db.query(Subscription).filter_by(hook_id=hook_id).first()
        if not sub:
            raise HTTPException(404, "Hook tidak ditemukan")

        if not gh_verify(sub.secret, body, x_hub_signature_256):
            raise HTTPException(401, "Signature tidak valid")

        payload = await request.json()
        event = x_github_event or "unknown"
        repo_name = (
            payload.get("repository", {}).get("full_name")
            if isinstance(payload, dict)
            else None
        ) or sub.repo or "-"

        if sub.events_csv and sub.events_csv != "*":
            allowed = [e.strip() for e in sub.events_csv.split(",") if e.strip()]
            if event not in allowed:
                log = WebhookEventLog(
                    subscription_id=sub.id,
                    hook_id=hook_id,
                    event_type=event,
                    repository=repo_name,
                    status="ignored",
                    payload=json.dumps(payload, ensure_ascii=False, default=str),
                )
                db.add(log)
                db.commit()
                return "ignored"

        bot = db.query(Bot).filter_by(id=sub.bot_id).first()
        dest = db.query(Destination).filter_by(id=sub.destination_id).first()
        if not bot or not dest:
            error_message = "Bot atau destination tidak tersedia"
            log = WebhookEventLog(
                subscription_id=sub.id,
                hook_id=hook_id,
                event_type=event,
                repository=repo_name,
                status="error",
                error_message=error_message,
                payload=json.dumps(payload, ensure_ascii=False, default=str),
            )
            db.add(log)
            db.commit()
            raise HTTPException(500, error_message)

        text = summarize_event(event, payload)
        status = "success"
        error_message = None
        try:
            await send_message(
                bot.token,
                dest.chat_id,
                text,
                topic_id=dest.topic_id,
                auto_split=True,
            )
        except Exception as exc:  # pragma: no cover - network failures
            status = "error"
            error_message = str(exc)
            raise
        finally:
            log = WebhookEventLog(
                subscription_id=sub.id,
                hook_id=hook_id,
                event_type=event,
                repository=repo_name,
                status=status,
                summary=text,
                payload=json.dumps(payload, ensure_ascii=False, default=str),
                error_message=error_message,
            )
            db.add(log)
            db.commit()

        dest_label = dest.title.strip() if dest.title else dest.chat_id
        return f"{event} event forwarded to {dest_label}"
