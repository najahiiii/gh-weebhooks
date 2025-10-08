"""Ruter BOTS?"""

from typing import Optional

from fastapi import APIRouter, Depends, Form, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.services.bots import BotSetupError, register_bot
from app.services.telegram import get_webhook_info

router = APIRouter(tags=["Bots"])

ADMIN_HTTP_KEY = settings.admin_http_key


def _check_admin_key(key_from_request: Optional[str]) -> bool:
    if not ADMIN_HTTP_KEY:
        return True
    return (key_from_request or "") == ADMIN_HTTP_KEY


@router.get("/bots/new", response_class=HTMLResponse)
def new_bot_form(key: Optional[str] = Query(None, alias="key")):
    if not _check_admin_key(key):
        return HTMLResponse(
            "<h3>Forbidden</h3><p>Invalid admin key.</p>", status_code=403
        )

    html = f"""
            <!doctype html>
            <html>
            <head><meta charset="utf-8"><title>Add Bot</title></head>
            <body>
            <h1>Add Telegram Bot</h1>
            <form method="post" action="/bots/add">
                <label>Admin Key (required if configured):<br>
                <input type="password" name="admin_key" placeholder="ADMIN_HTTP_KEY">
                </label><br><br>

                <label>Bot Token:<br>
                <input type="text" name="token" placeholder="123456789:AAAbbbCCC" required style="width: 420px;">
                </label><br><br>

                <label>Owner Telegram User ID:<br>
                <input type="text" name="owner_tg_id" placeholder="e.g. 123456789" required>
                </label><br><br>

                <label>Public Base URL (optional):<br>
                <input type="text" name="public_base_url" placeholder="{settings.public_base_url}" style="width: 420px;">
                </label><br><br>

                <button type="submit">Add Bot & Set Webhook</button>
            </form>
            <hr>
            <p>After success, open Telegram and send <code>/start</code> to your bot.</p>
            </body>
            </html>
            """
    return HTMLResponse(html)


@router.post("/bots/add", response_class=HTMLResponse)
async def add_bot(
    token: str = Form(...),
    owner_tg_id: str = Form(...),
    public_base_url: Optional[str] = Form(None),
    admin_key: Optional[str] = Form(None),
    session: Session = Depends(get_db),
):
    if not _check_admin_key(admin_key):
        return HTMLResponse(
            "<h3>Forbidden</h3><p>Invalid admin key.</p>", status_code=403
        )

    try:
        setup_result = await register_bot(
            session,
            token,
            owner_tg_id,
            public_base_url=public_base_url,
        )
    except BotSetupError as exc:
        return HTMLResponse(
            f"<h3>Error</h3><p>{exc}</p>",
            status_code=400,
        )

    info_link = f"/bots/info?token={token}"
    return HTMLResponse(
        f"""<!doctype html>
            <html>
            <body>
                <h3>Bot saved</h3>
                <p>bot_id: <code>{setup_result.bot_id}</code><br>owner_tg_id: <code>{owner_tg_id}</code></p>
                <p>Webhook URL: <code>{setup_result.base_url}/tg/{setup_result.bot_id}/{token}</code></p>
                <h4>setWebhook result</h4>
                <pre>{setup_result.webhook_result}</pre>
                <p><a href="{info_link}">Check getWebhookInfo</a></p>
                <p><a href="/bots/new">Add another bot</a></p>
            </body>
            </html>""",
        status_code=200 if setup_result.webhook_result.get("ok") else 500,
    )


@router.get("/bots/info", response_class=HTMLResponse)
async def bot_info(
    token: str,
    key: Optional[str] = Query(None, alias="key"),
):
    if not _check_admin_key(key):
        return HTMLResponse(
            "<h3>Forbidden</h3><p>Invalid admin key.</p>", status_code=403
        )
    result = await get_webhook_info(token)
    return HTMLResponse(
        f"""<!doctype html>
            <html>
            <body>
                <h3>getWebhookInfo</h3>
                <pre>{result}</pre>
                <p><a href="/bots/new">Back</a></p>
            </body>
            </html>"""
    )
