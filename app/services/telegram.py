"""Yet another tele services"""

from __future__ import annotations

from typing import Any, Iterable, Optional

import httpx
from fastapi import HTTPException

from app.config import settings

TELEGRAM_API_BASE = "https://api.telegram.org"
HTTP_TIMEOUT_SECONDS = 15
HTTP_TIMEOUT_SHORT_SECONDS = 10

JSONDict = dict[str, Any]


def _normalize_newlines(s: str) -> str:
    return (s or "").replace("\r\n", "\n").replace("\r", "\n")


def _split_html(text: str, limit: int = 4096) -> Iterable[str]:
    """Split text chars max 4096"""
    t = text or ""
    while len(t) > limit:
        cut = t.rfind("\n", 0, limit)
        if cut == -1:
            cut = limit
        yield t[:cut]
        t = t[cut:]
    if t:
        yield t


async def send_message(
    token: str,
    chat_id: int | str,
    html_text: str,
    topic_id: Optional[int] = None,
    *,
    disable_web_page_preview: bool = True,
    auto_split: bool = False,
) -> JSONDict | list[JSONDict]:
    """Se d message"""
    api = f"{TELEGRAM_API_BASE}/bot{token}/sendMessage"
    rendered = _normalize_newlines(html_text)

    payload_base: JSONDict = {
        "chat_id": chat_id,
        "text": rendered,
        "parse_mode": "HTML",
        "disable_web_page_preview": disable_web_page_preview,
    }
    if topic_id is not None:
        payload_base["message_thread_id"] = topic_id

    # Single send
    if not auto_split or len(rendered) <= 4096:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(api, json=payload_base)
        data = resp.json()
        if resp.status_code >= 300 or not data.get("ok", True):
            raise HTTPException(500, f"Telegram error: {resp.status_code} {resp.text}")
        return data

    # Auto split
    results: list[JSONDict] = []
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        for chunk in _split_html(rendered, 4096):
            p = dict(payload_base)
            p["text"] = chunk
            r = await client.post(api, json=p)
            d = r.json()
            if r.status_code >= 300 or not d.get("ok", True):
                raise HTTPException(500, f"Telegram error: {r.status_code} {r.text}")
            results.append(d)
    return results


async def get_chat_member(
    token: str, chat_id: int | str, user_id: int | str
) -> JSONDict:
    """Get tele chat member (JSON)."""
    url = f"{TELEGRAM_API_BASE}/bot{token}/getChatMember"
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SHORT_SECONDS) as client:
        r = await client.get(url, params={"chat_id": chat_id, "user_id": user_id})
    data = r.json()
    if r.status_code >= 300 or not data.get("ok", True):
        raise HTTPException(500, f"Telegram error: {r.status_code} {r.text}")
    return data


async def set_telegram_webhook(
    token: str,
    bot_id: str,
    base_url: Optional[str] = None,
    *,
    drop_pending_updates: bool = True,
) -> JSONDict:
    """Set Telegram webhook to {base}/tg/{bot_id}/{token}."""
    base = (base_url or settings.public_base_url).rstrip("/")
    target = f"{base}/tg/{bot_id}/{token}"

    payload: JSONDict = {
        "url": target,
        "drop_pending_updates": drop_pending_updates,
    }

    url_api = f"{TELEGRAM_API_BASE}/bot{token}/setWebhook"
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        r = await client.post(url_api, json=payload)
    data = r.json()
    if r.status_code >= 300 or not data.get("ok", True):
        raise HTTPException(500, f"Telegram error: {r.status_code} {r.text}")
    return data


async def get_webhook_info(token: str) -> JSONDict:
    """Get webhook info (JSON)."""
    url_api = f"{TELEGRAM_API_BASE}/bot{token}/getWebhookInfo"
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        r = await client.get(url_api)
    data = r.json()
    if r.status_code >= 300 or not data.get("ok", True):
        raise HTTPException(500, f"Telegram error: {r.status_code} {r.text}")
    return data
