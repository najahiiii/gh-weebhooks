"""Ruter BOTS?"""

from typing import Optional

from fastapi import APIRouter, Form, Query, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Bot
from app.services.users import ensure_user_by_tg_id as ensure_id
from app.services.telegram import set_telegram_webhook, get_webhook_info
from app.utils import parse_bot_id_from_token

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

    bid = parse_bot_id_from_token(token)
    if not bid:
        return HTMLResponse(
            "<h3>Error</h3><p>Invalid token format.</p>", status_code=400
        )

    # pastikan owner ada
    owner = ensure_id(session, owner_tg_id)

    if not owner.is_admin:
        owner.is_admin = True
        session.commit()

    # create/update bot
    bot = session.query(Bot).filter_by(bot_id=bid).first()
    if not bot:
        bot = Bot(owner_user_id=owner.id, bot_id=bid, token=token)
        session.add(bot)
    else:
        bot.owner_user_id = owner.id
        bot.token = token
    session.commit()

    # set webhook
    base = (public_base_url or settings.public_base_url).rstrip("/")
    result = await set_telegram_webhook(token, bid, base)

    info_link = f"/bots/info?token={token}"
    return HTMLResponse(
        f"""<!doctype html>
            <html>
            <body>
                <h3>Bot saved</h3>
                <p>bot_id: <code>{bid}</code><br>owner_tg_id: <code>{owner_tg_id}</code></p>
                <h4>setWebhook result</h4>
                <pre>{result}</pre>
                <p><a href="{info_link}">Check getWebhookInfo</a></p>
                <p><a href="/bots/new">Add another bot</a></p>
            </body>
            </html>""",
        status_code=200 if result.get("ok") else 500,
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
