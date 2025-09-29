"""Yet another tele services"""

from __future__ import annotations

import html
import re
from typing import Optional

import httpx
from fastapi import HTTPException

from app.config import settings


def _normalize_newlines(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n")


_code_inline_re = re.compile(r"`([^`\n]+)`")  # inline code: `...`
_bold_inline_re = re.compile(r"\*([^*\n]+)\*")  # bold: *...*


def _markdown_min_to_html(text: str) -> str:
    s = _normalize_newlines(text)
    s = html.escape(s, quote=False)
    s = _bold_inline_re.sub(r"<b>\1</b>", s)
    s = _code_inline_re.sub(r"<code>\1</code>", s)

    return s


async def send_message(
    token: str,
    chat_id: str,
    text: str,
    html: bool = True,
    topic_id: Optional[int] = None,
):
    """
    Kirim pesan Telegram. Default pakai HTML, dengan konversi ringan dari *bold* dan `code`.
    """
    url = f"https://api.telegram.org/bot{token}/sendMessage"

    if html:
        rendered = _markdown_min_to_html(text)
    else:
        rendered = _normalize_newlines(text)

    payload = {
        "chat_id": chat_id,
        "text": rendered,
        "disable_web_page_preview": True,
    }
    if html:
        payload["parse_mode"] = "HTML"
    if topic_id is not None:
        payload["message_thread_id"] = topic_id

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, json=payload)

    if r.status_code >= 300:
        raise HTTPException(500, f"Telegram error: {r.status_code} {r.text}")

    return r.json()


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
    token: str,
    bot_id: str,
    base_url: Optional[str] = None,
    *,
    drop_pending_updates: bool = True,
) -> dict:
    """
    Set Telegram webhook ke {base}/tg/{bot_id}/{token}
    """
    base = (base_url or settings.public_base_url).rstrip("/")
    target = f"{base}/tg/{bot_id}/{token}"

    payload = {
        "url": target,
        "drop_pending_updates": drop_pending_updates,
    }

    url_api = f"https://api.telegram.org/bot{token}/setWebhook"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url_api, json=payload)
        return r.json()


async def get_webhook_info(token: str) -> dict:
    """Get webhook info"""
    url_api = f"https://api.telegram.org/bot{token}/getWebhookInfo"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url_api)
    return r.json()
