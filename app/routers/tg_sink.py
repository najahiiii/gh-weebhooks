"""Sink route for Telegram webhooks to avoid 404 responses."""

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter(prefix="/tg", tags=["telegram"])


@router.post("/{bot_id}/{token}", response_class=PlainTextResponse)
async def telegram_webhook_sink(bot_id: str, token: str, request: Request) -> str:
    """
    Accept Telegram webhook callbacks without processing them.

    This keeps the bot webhook alive while the bot is used only for outbound messages.
    """
    # Consume the body to free up the request stream even though we ignore it.
    await request.body()
    return "ok"
