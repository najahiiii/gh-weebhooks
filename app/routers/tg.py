"""Ruter TG?"""

from __future__ import annotations

import uuid

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import Bot, Destination, Subscription, User
from app.schemas import TgUpdate
from app.services.telegram import get_chat_member, send_message
from app.utils import CMD_HELP, parse_bot_id_from_token, parse_topic_id

router = APIRouter(prefix="/tg", tags=["telegram"])


def ensure_user(db: Session, tg_user: dict) -> User:
    """
    Get or create a User row for a Telegram sender.

    It also syncs the admin flag if the user's Telegram ID appears in ADMIN_IDS.
    """
    uid = str(tg_user.get("id"))
    u = db.query(User).filter_by(telegram_user_id=uid).first()
    if not u:
        u = User(
            telegram_user_id=uid,
            username=tg_user.get("username") or "",
            is_admin=(uid in settings.admin_ids),
        )
        db.add(u)
        db.commit()
    else:
        if (uid in settings.admin_ids) and not u.is_admin:
            u.is_admin = True
            db.commit()
    return u


@router.post("/{bot_id}/{token}", response_class=PlainTextResponse)
async def telegram_webhook(bot_id: str, token: str, upd: TgUpdate):
    """
    Telegram webhook endpoint (multi-bot mode).

    The URL includes `{bot_id}` and `{token}` of a user's bot. Telegram will POST updates
    here once the user sets their bot webhook to this URL. On first use, a `Bot` record
    is auto-created for the requesting user. Commands are handled to manage destinations
    and subscriptions.
    """
    payload = upd.dict()
    msg = (
        payload.get("message")
        or payload.get("edited_message")
        or payload.get("channel_post")
    )
    if not msg:
        return "ok"

    chat = msg.get("chat") or {}
    from_user = msg.get("from") or {}
    text = (msg.get("text") or "").strip()
    topic_id_from_msg = msg.get("message_thread_id")
    chat_id_current = str(chat.get("id"))

    db = SessionLocal()
    user = ensure_user(db, from_user)

    b = db.query(Bot).filter_by(bot_id=bot_id).first()
    if not b:
        b = Bot(owner_user_id=user.id, bot_id=bot_id, token=token)
        db.add(b)
        db.commit()
    elif b.token != token:
        b.token = token
        db.commit()

    async def reply(s: str):
        await send_message(b.token, chat_id_current, s, topic_id=topic_id_from_msg, markdown=True)

    if not text or not text.startswith("/"):
        await reply("Gunakan perintah. /help")
        return "ok"

    cmd, *rest = text.split(maxsplit=1)
    arg = rest[0] if rest else ""

    # user commands
    if cmd == "/start":
        await reply(f"Halo! Kamu *{'admin' if user.is_admin else 'user'}*.\n{CMD_HELP}")

    elif cmd == "/help":
        await reply(CMD_HELP)

    elif cmd == "/connectbot":
        if not arg:
            await reply("Format: /connectbot <token_bot_telegram>")
        else:
            bid = parse_bot_id_from_token(arg)
            if not bid:
                await reply("Token tidak valid.")
            else:
                bot = db.query(Bot).filter_by(bot_id=bid).first()
                if not bot:
                    bot = Bot(owner_user_id=user.id, bot_id=bid, token=arg)
                    db.add(bot)
                else:
                    bot.owner_user_id = user.id
                    bot.token = arg
                db.commit()
                await reply(
                    "Bot terhubung ✅\n"
                    "Set webhook Telegram ke:\n"
                    f"`{settings.public_base_url}/tg/{bid}/{arg}`"
                )

    elif cmd == "/listbot":
        bots = db.query(Bot).filter_by(owner_user_id=user.id).all()
        if not bots:
            await reply("Belum ada bot. /connectbot <token>")
        else:
            lines = ["Bot milikmu:"]
            for bt in bots:
                lines.append(f"- id=`{bt.bot_id}` dibuat={bt.created_at.isoformat()}")
            await reply("\n".join(lines))

    elif cmd == "/adddest":
        if not arg:
            await reply(
                "Format:\n/adddest <chat_id> [nama]\n/adddest here [nama]\n"
                "/adddest <chat_id>:<topic_id> [nama]"
            )
        else:
            parts = arg.split(maxsplit=1)
            title = parts[1] if len(parts) > 1 else ""
            dest_count = db.query(Destination).filter_by(owner_user_id=user.id).count()
            if parts[0].lower() == "here":
                dest = Destination(
                    owner_user_id=user.id,
                    chat_id=chat_id_current,
                    title=title,
                    is_default=(dest_count == 0),
                    topic_id=topic_id_from_msg,
                )
                db.add(dest)
                db.commit()
                await reply(
                    f"Destination (here) ditambah. id={dest.id} chat_id={dest.chat_id} "
                    f"topic_id={dest.topic_id or '-'} default={dest.is_default}"
                )
            else:
                chat_arg = parts[0]
                topic_val = None
                if ":" in chat_arg:
                    cid, tid = chat_arg.split(":", 1)
                    chat_arg = cid
                    topic_val = parse_topic_id(tid)
                dest = Destination(
                    owner_user_id=user.id,
                    chat_id=chat_arg,
                    title=title,
                    is_default=(dest_count == 0),
                    topic_id=topic_val,
                )
                db.add(dest)
                db.commit()
                await reply(
                    f"Destination ditambah. id={dest.id} chat_id={dest.chat_id} "
                    f"topic_id={dest.topic_id or '-'} default={dest.is_default}"
                )

    elif cmd == "/listdest":
        dests = db.query(Destination).filter_by(owner_user_id=user.id).all()
        if not dests:
            await reply("Belum ada destination.")
        else:
            lines = ["Daftar destination:"]
            for d in dests:
                star = "⭐" if d.is_default else " "
                nm = d.title or ""
                lines.append(
                    f"{star} id={d.id} chat_id={d.chat_id} topic_id={d.topic_id or '-'} {nm}"
                )
            await reply("\n".join(lines))

    elif cmd == "/usedest":
        if not arg or not arg.isdigit():
            await reply("Format: /usedest <dest_id>")
        else:
            did = int(arg)
            dest = (
                db.query(Destination).filter_by(id=did, owner_user_id=user.id).first()
            )
            if not dest:
                await reply("Destination tidak ditemukan.")
            else:
                db.query(Destination).filter_by(owner_user_id=user.id).update(
                    {"is_default": False}
                )
                dest.is_default = True
                db.commit()
                await reply(f"Default destination => id={dest.id}")

    elif cmd == "/subscribe":
        if not arg:
            await reply(
                "Format: /subscribe <owner/repo> [event1,event2,...]\n"
                "Contoh: /subscribe octocat/Hello-World push,pull_request"
            )
        else:
            parts = arg.split(maxsplit=1)
            repo = parts[0].strip()
            events_csv = (parts[1].strip() if len(parts) > 1 else "*") or "*"
            if "/" not in repo:
                await reply("Repo harus format owner/repo.")
            else:
                bot = (
                    db.query(Bot)
                    .filter_by(owner_user_id=user.id)
                    .order_by(Bot.id.desc())
                    .first()
                )
                if not bot:
                    await reply("Belum ada bot. /connectbot <token> dulu.")
                else:
                    dest = (
                        db.query(Destination)
                        .filter_by(owner_user_id=user.id, is_default=True)
                        .first()
                    )
                    if not dest:
                        await reply(
                            "Belum ada destination default. /adddest ... lalu /usedest <id>."
                        )
                    else:
                        hook_id = uuid.uuid4().hex
                        secret = uuid.uuid4().hex
                        sub = Subscription(
                            owner_user_id=user.id,
                            hook_id=hook_id,
                            secret=secret,
                            repo=repo,
                            events_csv=events_csv,
                            bot_id=bot.id,
                            destination_id=dest.id,
                        )
                        db.add(sub)
                        db.commit()
                        payload_url = f"{settings.public_base_url}/wh/{hook_id}"
                        out = (
                            f"Langganan dibuat ✅\n"
                            f"id={sub.id}\nrepo={repo}\nacara={events_csv}\n\n"
                            f"GitHub Webhook config:\n"
                            f"- Payload URL: `{payload_url}`\n"
                            f"- Content type: `application/json`\n"
                            f"- Secret: `{secret}`\n"
                            f"- Events: pilih sesuai kebutuhan\n"
                        )
                        await reply(out)

    elif cmd == "/listsubs":
        subs = db.query(Subscription).filter_by(owner_user_id=user.id).all()
        if not subs:
            await reply("Belum ada langganan.")
        else:
            lines = ["Daftar langganan:"]
            for s in subs:
                lines.append(
                    f"id={s.id} repo={s.repo} events={s.events_csv} hook=/wh/{s.hook_id}"
                )
            await reply("\n".join(lines))

    elif cmd == "/unsubscribe":
        if not arg or not arg.isdigit():
            await reply("Format: /unsubscribe <id>")
        else:
            sid = int(arg)
            s = db.query(Subscription).filter_by(id=sid, owner_user_id=user.id).first()
            if not s:
                await reply("Langganan tidak ditemukan.")
            else:
                db.delete(s)
                db.commit()
                await reply("Langganan dihapus.")

    elif cmd == "/testdest":
        dest = (
            db.query(Destination)
            .filter_by(owner_user_id=user.id, is_default=True)
            .first()
        )
        if not dest:
            await reply("Belum ada destination default.")
        else:
            await send_message(
                b.token,
                dest.chat_id,
                "Test ke destination default.",
                topic_id=dest.topic_id,
                markdown=True
            )
            await reply("Dikirim.")

    elif cmd == "/whoami":
        await reply(f"Kamu: *{'admin' if user.is_admin else 'user'}*")

    elif cmd == "/promote":
        if not user.is_admin:
            await reply("Hanya admin.")
        elif not arg:
            await reply("Format: /promote <telegram_user_id>")
        else:
            target = db.query(User).filter_by(telegram_user_id=arg.strip()).first()
            if not target:
                await reply("User tidak ditemukan.")
            else:
                target.is_admin = True
                db.commit()
                await reply(f"Promote sukses: {target.telegram_user_id} kini admin.")

    elif cmd == "/demote":
        if not user.is_admin:
            await reply("Hanya admin.")
        elif not arg:
            await reply("Format: /demote <telegram_user_id>")
        else:
            target = db.query(User).filter_by(telegram_user_id=arg.strip()).first()
            if not target:
                await reply("User tidak ditemukan.")
            else:
                target.is_admin = False
                db.commit()
                await reply(
                    f"Demote sukses: {target.telegram_user_id} kini user biasa."
                )

    elif cmd == "/listusers":
        if not user.is_admin:
            await reply("Hanya admin.")
        else:
            us = db.query(User).order_by(User.id).all()
            lines = ["Users:"]
            for uu in us:
                flag = "👑" if uu.is_admin else " "
                lines.append(
                    f"{flag} id={uu.id} tg={uu.telegram_user_id} @{uu.username or '-'}"
                )
            await reply("\n".join(lines))

    elif cmd == "/listsubs_all":
        if not user.is_admin:
            await reply("Hanya admin.")
        else:
            subs = db.query(Subscription).order_by(Subscription.id.desc()).all()
            if not subs:
                await reply("Belum ada subscription.")
            else:
                lines = ["Semua subscription:"]
                for s in subs:
                    lines.append(
                        f"#{s.id} owner={s.owner_user_id} {s.repo} "
                        f"events={s.events_csv} hook=/wh/{s.hook_id}"
                    )
                await reply("\n".join(lines))

    elif cmd == "/checkdest":
        if not arg or not arg.isdigit():
            await reply("Format: /checkdest <dest_id>")
        else:
            d = (
                db.query(Destination)
                .filter_by(id=int(arg), owner_user_id=user.id)
                .first()
            )
            if not d:
                await reply("Destination tidak ditemukan.")
            else:
                bot_numeric_id = parse_bot_id_from_token(b.token)
                r = await get_chat_member(b.token, d.chat_id, bot_numeric_id)
                if r.status_code >= 300:
                    await reply(f"Gagal cek: {r.status_code} {r.text}")
                else:
                    data = r.json()
                    status = (data.get("result") or {}).get("status")
                    await reply(
                        f"Status bot di chat ini: *{status or 'unknown'}* "
                        "(Channel perlu 'administrator')."
                    )

    else:
        await reply("Perintah tidak dikenal. /help")

    return "ok"
