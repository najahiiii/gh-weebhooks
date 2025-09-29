"""Yet another tele services"""

from __future__ import annotations

from typing import Optional

import httpx
from fastapi import HTTPException

from app.config import settings


async def send_message(
    token: str,
    chat_id: str,
    text: str,
    markdown: bool = True,
    topic_id: Optional[int] = None,
):
    """
    Send a Telegram message using a specific bot token.

    Parameters
    ----------
    token : str
        Telegram bot token to use for sending.
    chat_id : str
        Target chat ID (PM/group/channel).
    text : str
        Message body.
    markdown : bool
        If True, send with parse_mode=markdown.
    topic_id : int | None
        If provided, included as `message_thread_id` for Group Topics.
    """
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }
    if markdown:
        payload["parse_mode"] = "markdown"
    if topic_id:
        payload["message_thread_id"] = topic_id
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, json=payload)
        if r.status_code >= 300:
            raise HTTPException(500, f"Telegram error: {r.status_code} {r.text}")


async def get_chat_member(token: str, chat_id: str, user_id: str):
    """Get tele chat member, why not?

    Args:
        token (str): your telegram bot token
        chat_id (str): your chat id
        user_id (str): user id?

    Returns:
        json: absolutely json string
    """
    url = f"https://api.telegram.org/bot{token}/getChatMember"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url, params={"chat_id": chat_id, "user_id": user_id})
    return r


async def set_telegram_webhook(
    token: str, bot_id: str, base_url: Optional[str] = None
) -> dict:
    """
    Set Telegram webhook to {base_url}/tg/{bot_id}/{token}
    """
    base = (base_url or settings.public_base_url).rstrip("/")
    target = f"{base}/tg/{bot_id}/{token}"
    url_api = f"https://api.telegram.org/bot{token}/setWebhook"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url_api, data={"url": target})
    return r.json()


async def get_webhook_info(token: str) -> dict:
    """Get webhook info"""
    url_api = f"https://api.telegram.org/bot{token}/getWebhookInfo"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url_api)
    return r.json()
