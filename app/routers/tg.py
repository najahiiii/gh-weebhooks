"""Ruter TG?"""

from __future__ import annotations

import json
import traceback
import uuid
from html import escape as _esc_html

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


def _esc(v) -> str:
    return _esc_html(str(v or ""), quote=True)


def _code(v) -> str:
    return f"<code>{_esc(v)}</code>"


def _pre(v) -> str:
    return f"<pre>{_esc(v)}</pre>"


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
    try:
        payload = upd.dict()
        print(
            "[TG] update:",
            json.dumps(
                {
                    "has_message": bool(payload.get("message")),
                    "has_channel_post": bool(payload.get("channel_post")),
                    "has_edited_message": bool(payload.get("edited_message")),
                },
                ensure_ascii=False,
            ),
        )
        msg = (
            payload.get("message")
            or payload.get("edited_message")
            or payload.get("channel_post")
        )

        chat = msg.get("chat") or {}
        from_user = msg.get("from") or {}
        text = (msg.get("text") or "").strip()
        topic_id_from_msg = msg.get("message_thread_id")
        chat_id_current = str(chat.get("id"))

        db = SessionLocal()

        if not text or not text.startswith("/"):
            return "ok"
        user = ensure_user(db, from_user)
        b = db.query(Bot).filter_by(bot_id=bot_id).first()

        is_owner = bool(b and b.owner_user_id == user.id)
        is_admin = bool(user.is_admin)

        if b and (b.token != token) and not (is_owner or is_admin):
            return "ok"

        if not b:
            if not (is_owner or is_admin):
                pass
            b = Bot(owner_user_id=user.id, bot_id=bot_id, token=token)
            db.add(b)
            db.commit()
        elif b.token != token:
            if is_owner or is_admin:
                b.token = token
                db.commit()

        allowed_cmds = {"/start", "/help"}
        cmd, *rest = text.split(maxsplit=1)
        arg = rest[0] if rest else ""

        if (cmd not in allowed_cmds) and not (is_owner or is_admin):
            await send_message(
                b.token,
                chat_id_current,
                "❌ Kamu bukan owner bot ini. Minta owner menjadikanmu admin atau gunakan bot milikmu sendiri.",
                topic_id=topic_id_from_msg,
                auto_split=True,
            )
            return "ok"

        async def reply(s: str):
            # Semua s dianggap sudah HTML
            await send_message(
                b.token, chat_id_current, s, topic_id=topic_id_from_msg, auto_split=True
            )

        if not text or not text.startswith("/"):
            return "ok"

        cmd, *rest = text.split(maxsplit=1)
        arg = rest[0] if rest else ""

        # user commands
        if cmd == "/start":
            role = "admin" if user.is_admin else "user"
            await reply(f"Halo! Kamu <b>{_esc(role)}</b>.\n{_pre(CMD_HELP)}")

        elif cmd == "/help":
            await reply(_pre(CMD_HELP))

        elif cmd == "/connectbot":
            if not arg:
                await reply(
                    "Format: <code>/connectbot &lt;token_bot_telegram&gt;</code>"
                )
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
                        f"{_pre(f'{settings.public_base_url}/tg/{bid}/{arg}')}"
                    )

        elif cmd == "/listbot":
            bots = db.query(Bot).filter_by(owner_user_id=user.id).all()
            if not bots:
                await reply("Belum ada bot. <code>/connectbot &lt;token&gt;</code>")
            else:
                lines = ["Bot milikmu:"]
                for bt in bots:
                    lines.append(
                        f"- id={_code(bt.bot_id)} dibuat={_code(bt.created_at.isoformat())}"
                    )
                await reply("\n".join(lines))

        elif cmd == "/adddest":
            if not arg:
                await reply(
                    "Format:\n"
                    "<code>/adddest &lt;chat_id&gt; [nama]</code>\n"
                    "<code>/adddest here [nama]</code>\n"
                    "<code>/adddest &lt;chat_id&gt;:&lt;topic_id&gt; [nama]</code>"
                )
            else:
                parts = arg.split(maxsplit=1)
                title = parts[1] if len(parts) > 1 else ""
                dest_count = (
                    db.query(Destination).filter_by(owner_user_id=user.id).count()
                )
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
                        "Destination (here) ditambah. "
                        f"id={_code(dest.id)} chat_id={_code(dest.chat_id)} "
                        f"topic_id={_code(dest.topic_id or '-')} default={_code(dest.is_default)}"
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
                        "Destination ditambah. "
                        f"id={_code(dest.id)} chat_id={_code(dest.chat_id)} "
                        f"topic_id={_code(dest.topic_id or '-')} default={_code(dest.is_default)}"
                    )

        elif cmd == "/listdest":
            dests = db.query(Destination).filter_by(owner_user_id=user.id).all()
            if not dests:
                await reply("Belum ada destination.")
            else:
                lines = ["Daftar destination:"]
                for d in dests:
                    star = "⭐" if d.is_default else " "
                    nm = _esc(d.title or "")
                    lines.append(
                        f"{star} id={_code(d.id)} chat_id={_code(d.chat_id)} "
                        f"topic_id={_code(d.topic_id or '-')} {nm}"
                    )
                await reply("\n".join(lines))

        elif cmd == "/usedest":
            if not arg or not arg.isdigit():
                await reply("Format: <code>/usedest &lt;dest_id&gt;</code>")
            else:
                did = int(arg)
                dest = (
                    db.query(Destination)
                    .filter_by(id=did, owner_user_id=user.id)
                    .first()
                )
                if not dest:
                    await reply("Destination tidak ditemukan.")
                else:
                    db.query(Destination).filter_by(owner_user_id=user.id).update(
                        {"is_default": False}
                    )
                    dest.is_default = True
                    db.commit()
                    await reply(f"Default destination ⇒ id={_code(dest.id)}")

        elif cmd == "/subscribe":
            if not arg:
                await reply(
                    "Format: <code>/subscribe &lt;owner/repo&gt; [event1,event2,...]</code>\n"
                    "Contoh: <code>/subscribe octocat/Hello-World push,pull_request</code>"
                )
            else:
                parts = arg.split(maxsplit=1)
                repo = parts[0].strip()
                events_csv = (parts[1].strip() if len(parts) > 1 else "*") or "*"
                if "/" not in repo:
                    await reply("Repo harus format <code>owner/repo</code>.")
                else:
                    bot = (
                        db.query(Bot)
                        .filter_by(owner_user_id=user.id)
                        .order_by(Bot.id.desc())
                        .first()
                    )
                    if not bot:
                        await reply(
                            "Belum ada bot. <code>/connectbot &lt;token&gt;</code> dulu."
                        )
                    else:
                        dest = (
                            db.query(Destination)
                            .filter_by(owner_user_id=user.id, is_default=True)
                            .first()
                        )
                        if not dest:
                            await reply(
                                "Belum ada destination default. "
                                "Gunakan <code>/adddest ...</code> lalu <code>/usedest &lt;id&gt;</code>."
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
                                "Langganan dibuat ✅\n"
                                f"id={_code(sub.id)}\n"
                                f"repo={_code(repo)}\n"
                                f"acara={_code(events_csv)}\n\n"
                                "GitHub Webhook config:\n"
                                f"- Payload URL: {_code(payload_url)}\n"
                                f"- Content type: {_code('application/json')}\n"
                                f"- Secret: {_code(secret)}\n"
                                "- Events: pilih sesuai kebutuhan\n"
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
                        f"id={_code(s.id)} repo={_code(s.repo)} "
                        f"events={_esc(s.events_csv)} hook={_code('/wh/' + s.hook_id)}"
                    )
                await reply("\n".join(lines))

        elif cmd == "/unsubscribe":
            if not arg or not arg.isdigit():
                await reply("Format: <code>/unsubscribe &lt;id&gt;</code>")
            else:
                sid = int(arg)
                s = (
                    db.query(Subscription)
                    .filter_by(id=sid, owner_user_id=user.id)
                    .first()
                )
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
                    auto_split=True,
                )
                await reply("Dikirim.")

        elif cmd == "/whoami":
            await reply(f"Kamu: <b>{'admin' if user.is_admin else 'user'}</b>")

        elif cmd == "/promote":
            if not user.is_admin:
                await reply("Hanya admin.")
            elif not arg:
                await reply("Format: <code>/promote &lt;telegram_user_id&gt;</code>")
            else:
                target = db.query(User).filter_by(telegram_user_id=arg.strip()).first()
                if not target:
                    await reply("User tidak ditemukan.")
                else:
                    target.is_admin = True
                    db.commit()
                    await reply(
                        f"Promote sukses: {_code(target.telegram_user_id)} kini admin."
                    )

        elif cmd == "/demote":
            if not user.is_admin:
                await reply("Hanya admin.")
            elif not arg:
                await reply("Format: <code>/demote &lt;telegram_user_id&gt;</code>")
            else:
                target = db.query(User).filter_by(telegram_user_id=arg.strip()).first()
                if not target:
                    await reply("User tidak ditemukan.")
                else:
                    target.is_admin = False
                    db.commit()
                    await reply(
                        f"Demote sukses: {_code(target.telegram_user_id)} kini user biasa."
                    )

        elif cmd == "/listusers":
            if not user.is_admin:
                await reply("Hanya admin.")
            else:
                us = db.query(User).order_by(User.id).all()
                lines = ["Users:"]
                for uu in us:
                    flag = "👑" if uu.is_admin else " "
                    uname = f"@{uu.username}" if uu.username else "-"
                    lines.append(
                        f"{flag} id={_code(uu.id)} tg={_code(uu.telegram_user_id)} {uname}"
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
                            f"#{_code(s.id)} owner={_code(s.owner_user_id)} {_esc(s.repo)} "
                            f"events={_esc(s.events_csv)} hook={_code('/wh/' + s.hook_id)}"
                        )
                    await reply("\n".join(lines))

        elif cmd == "/checkdest":
            if not arg or not arg.isdigit():
                await reply("Format: <code>/checkdest &lt;dest_id&gt;</code>")
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
                    data = await get_chat_member(b.token, d.chat_id, bot_numeric_id)
                    if not data.get("ok", False):
                        await reply(
                            f"Gagal cek: {_code(data.get('error_code', '???'))} "
                            f"{_esc(data.get('description', ''))}"
                        )
                    else:
                        status = (data.get("result") or {}).get("status")
                        await reply(
                            f"Status bot di chat ini: <b>{_esc(status or 'unknown')}</b> "
                            "(Channel perlu <i>administrator</i>)."
                        )
        else:
            await reply("Perintah tidak dikenal. <code>/help</code>")

        return "ok"

    except Exception:
        print("[TG] Exception:\n", traceback.format_exc())
        return "ok"
