"""Yet another tele services"""

from __future__ import annotations

from typing import Optional

import httpx
from fastapi import HTTPException

from app.utils import mdv2_escape


async def send_message(
    token: str,
    chat_id: str,
    text: str,
    markdown_v2: bool = True,
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
        Message body (will be MarkdownV2-escaped by default).
    markdown_v2 : bool
        If True, send with parse_mode=MarkdownV2.
    topic_id : int | None
        If provided, included as `message_thread_id` for Group Topics.
    """
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": mdv2_escape(text) if markdown_v2 else text,
        "parse_mode": "MarkdownV2" if markdown_v2 else None,
        "disable_web_page_preview": True,
    }
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
