"""
GitHub → Telegram Notifier (multi-user, multi-bot) with Topics & Channels

Overview
--------
This FastAPI app lets multiple end-users connect their own Telegram bots and
receive GitHub Webhook notifications in Telegram chats:

- Multi-user: Each Telegram user has their own account in `users`.
- Multi-bot (per user): Users can register one or more Telegram bot tokens in `bots`.
- Destinations: Users can store arbitrary Telegram destinations (PM, groups, channels)
in `destinations`, optionally with `topic_id` to support Group Topics.
- Subscriptions: For each GitHub repo, users create a webhook subscription that binds:
`owner/repo` + `bot_id` + `destination_id`. Incoming GitHub events are forwarded via
the selected bot to the selected chat/topic.

Security
--------
- GitHub requests are authenticated using HMAC SHA-256 (`X-Hub-Signature-256`) with
    a per-subscription `secret`.
- Telegram bot tokens provided by users are stored in the database—keep the DB protected.
- The Telegram webhook endpoint embeds the bot token in the URL (pragmatic but sensitive);
    always expose the server over HTTPS and restrict logs.

Time Zone
---------
All timestamps are stored with timezone awareness in WIB (Asia/Jakarta, UTC+7).

Main Endpoints
--------------
- POST /tg/{bot_id}/{token} : Telegram webhook for a specific user-bot
- POST /wh/{hook_id}        : GitHub webhook endpoint for a subscription
- GET  /                    : Health check
"""

import datetime as dt
import hashlib
import hmac
import os
import uuid
from textwrap import dedent
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

# =============================================================================
# Basic configuration
# =============================================================================
load_dotenv()
DB_URL = os.getenv("DB_URL", "sqlite:///./github_tg.sqlite3")
ADMIN_IDS = {s.strip() for s in os.getenv("ADMIN_USER_IDS", "").split(",") if s.strip()}
PUBLIC_BASE_URL = os.getenv(
    "PUBLIC_BASE_URL", "https://yourdomain.exe"
)  # used to generate GitHub webhook URLs

engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()
TZ = ZoneInfo("Asia/Jakarta")


def now_wib():
    """
    Return the current timezone-aware datetime in WIB (Asia/Jakarta, UTC+7).
    """
    return dt.datetime.now(tz=TZ)


# =============================================================================
# Database models
# =============================================================================
class User(Base):
    """
    Represents a Telegram user of this app.

    Fields
    ------
    telegram_user_id : str
        Telegram's numeric user ID, stored as string for safety.
    username : str
        Telegram @username (may be empty).
    first_seen_at : datetime
        First time the user interacted with the bot (WIB).
    is_admin : bool
        Application-level superuser flag (not related to Telegram chat rights).

    Relations
    ---------
    bots : list[Bot]
        Telegram bots registered by this user.
    destinations : list[Destination]
        Saved Telegram destinations (PM/Group/Channel, optionally with topic).
    subs : list[Subscription]
        GitHub webhook subscriptions owned by this user.
    """

    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    telegram_user_id = Column(String, unique=True, index=True)  # keep string-safe
    username = Column(String)
    first_seen_at = Column(DateTime, default=now_wib)
    is_admin = Column(Boolean, default=False)

    bots = relationship("Bot", back_populates="owner", cascade="all,delete")
    destinations = relationship(
        "Destination", back_populates="owner", cascade="all,delete"
    )
    subs = relationship("Subscription", back_populates="owner", cascade="all,delete")


class Bot(Base):
    """
    A Telegram bot (token) registered by a user.

    Fields
    ------
    bot_id : str
        The numeric prefix before ":" in the Telegram bot token.
    token : str
        Full Telegram bot token (keep secure!).
    created_at : datetime
        When this bot record was created (WIB).

    Relations
    ---------
    owner : User
        The user who owns this bot token.
    subs : list[Subscription]
        Subscriptions that will send messages with this bot.
    """

    __tablename__ = "bots"
    id = Column(Integer, primary_key=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), index=True)
    bot_id = Column(String, index=True)  # numeric part before ":" in token
    token = Column(String)  # full token
    created_at = Column(DateTime, default=now_wib)

    owner = relationship("User", back_populates="bots")
    subs = relationship("Subscription", back_populates="bot")


class Destination(Base):
    """
    A Telegram message destination.

    Fields
    ------
    chat_id : str
        PM: user id; Group/Channel: usually '-100…' or '@channelusername'.
    title : str
        Optional label for user convenience.
    is_default : bool
        If True, this destination will be used for new subscriptions by default.
    topic_id : int | None
        Telegram forum topic ID (message_thread_id) for supergroups with Topics.
    """

    __tablename__ = "destinations"
    id = Column(Integer, primary_key=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), index=True)
    chat_id = Column(String, index=True)
    title = Column(String, default="")
    is_default = Column(Boolean, default=False)
    topic_id = Column(Integer, nullable=True)

    owner = relationship("User", back_populates="destinations")
    subs = relationship("Subscription", back_populates="destination")


class Subscription(Base):
    """
    A GitHub webhook subscription owned by a user.

    Fields
    ------
    hook_id : str
        Unique identifier used in the webhook path (/wh/{hook_id}).
    secret : str
        HMAC secret to verify GitHub payload signatures.
    repo : str
        GitHub repository in 'owner/repo' format.
    events_csv : str
        Comma-separated list of allowed events (or '*' to allow all).
    created_at : datetime
        When this subscription was created (WIB).

    Relations
    ---------
    owner : User
        The subscription owner.
    bot : Bot
        The Telegram bot used to send notifications.
    destination : Destination
        Where notifications will be sent.
    """

    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), index=True)
    hook_id = Column(String, unique=True, index=True)  # uuid hex
    secret = Column(String)  # HMAC secret GitHub
    repo = Column(String)  # "owner/repo"
    events_csv = Column(String, default="*")  # "*" or "push,pull_request"
    bot_id = Column(Integer, ForeignKey("bots.id"), index=True)
    destination_id = Column(Integer, ForeignKey("destinations.id"), index=True)
    created_at = Column(DateTime, default=now_wib)

    owner = relationship("User", back_populates="subs")
    bot = relationship("Bot", back_populates="subs")
    destination = relationship("Destination", back_populates="subs")


Base.metadata.create_all(engine)

# =============================================================================
# App
# =============================================================================
app = FastAPI(title="GitHub → Telegram (multi-user, topics & channels)")


def db():
    """
    Create a new SQLAlchemy session.
    Caller is responsible for committing/closing when appropriate.
    """
    return SessionLocal()


def parse_bot_id_from_token(token: str) -> Optional[str]:
    """
    Extract the numeric bot ID from a Telegram bot token.

    Example
    -------
    '123456789:AA...' → '123456789'
    """
    return token.split(":", 1)[0] if ":" in token else None


def mdv2_escape(s: str) -> str:
    """
    Escape special characters for Telegram MarkdownV2 to prevent formatting issues.
    """
    for ch in r"_*[]()~`>#+-=|{}.!":
        s = s.replace(ch, f"\\{ch}")
    return s


async def tg_send(
    token: str,
    chat_id: str,
    text: str,
    markdown_v2: bool = True,
    topic_id: int | None = None,
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
        payload["message_thread_id"] = topic_id  # key for Group Topic
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, json=payload)
        if r.status_code >= 300:
            raise HTTPException(500, f"Telegram error: {r.status_code} {r.text}")


def gh_verify(secret: str, body: bytes, signature_header: Optional[str]) -> bool:
    """
    Verify GitHub webhook HMAC signature (X-Hub-Signature-256).

    Returns
    -------
    bool
        True if valid, False otherwise.
    """
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    sig = signature_header.split("=", 1)[1]
    mac = hmac.new(secret.encode(), msg=body, digestmod=hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, sig)


def pretty_github_event(event: str, payload: dict) -> str:
    """
    Produce a concise, human-readable summary for a GitHub webhook event.
    Covers common events: ping, push, pull_request, issues, release, workflow_run.
    """
    if event == "ping":
        return "*Webhook terhubung* \\- pong ✅"

    if event == "push":
        repo = payload.get("repository", {}).get("full_name", "?")
        branch = (payload.get("ref") or "refs/heads/?").split("/")[-1]
        pusher = payload.get("pusher", {}).get("name") or payload.get("sender", {}).get(
            "login", "?"
        )
        commits = payload.get("commits", []) or []
        lines = [
            f"*[{repo}]* push ke *{branch}* oleh *{pusher}* ({len(commits)} commit)"
        ]
        for c in commits[:5]:
            sha = (c.get("id") or "")[:7]
            msg = (c.get("message") or "").split("\n")[0][:120]
            url = c.get("url") or ""
            lines.append(f"`{sha}` {msg}\n{url}")
        if len(commits) > 5:
            lines.append(f"_+{len(commits)-5} commit lainnya_")
        return "\n\n".join(lines)

    if event == "pull_request":
        action = payload.get("action")
        repo = payload.get("repository", {}).get("full_name", "?")
        pr = payload.get("pull_request", {}) or {}
        num = pr.get("number")
        title = pr.get("title", "")
        user = (pr.get("user") or {}).get("login", "?")
        url = pr.get("html_url", "")
        return f"*PR* {repo} \\#{num} *{action}* oleh *{user}*\n*{title}*\n{url}"

    if event == "issues":
        action = payload.get("action")
        repo = payload.get("repository", {}).get("full_name", "?")
        issue = payload.get("issue", {}) or {}
        num = issue.get("number")
        title = issue.get("title", "")
        user = (issue.get("user") or {}).get("login", "?")
        url = issue.get("html_url", "")
        return f"*Issue* {repo} \\#{num} *{action}* oleh *{user}*\n*{title}*\n{url}"

    if event == "release":
        action = payload.get("action")
        repo = payload.get("repository", {}).get("full_name", "?")
        rel = payload.get("release", {}) or {}
        tag = rel.get("tag_name", "")
        url = rel.get("html_url", "")
        return f"*Release* {repo} *{action}*: *{tag}*\n{url}"

    if event == "workflow_run":
        repo = payload.get("repository", {}).get("full_name", "?")
        wr = payload.get("workflow_run", {}) or {}
        name = wr.get("name", "")
        status = wr.get("status", "")
        conclusion = wr.get("conclusion") or ""
        url = wr.get("html_url", "")
        return f"*CI* {repo}: *{name}* — *{status}* {conclusion}\n{url}"

    return f"*Event*: {event} diterima \\(diringkas\\)"


def parse_topic_id(s: str) -> Optional[int]:
    """Return a positive int topic_id or None if invalid."""
    try:
        v = int(s)
        return v if v > 0 else None
    except (ValueError, TypeError):
        return None


# =============================================================================
# Telegram Webhook
# =============================================================================
class TgUpdate(BaseModel):
    """
    Minimal model for Telegram Update.
    Only fields used by this app are included.
    """

    update_id: Optional[int] = None
    message: Optional[dict] = None
    edited_message: Optional[dict] = None
    channel_post: Optional[dict] = None


CMD_HELP = """Perintah:
/start – daftarkan diri & cek status
/adddest <chat_id> [nama] – tambah tujuan (PM/Group/Channel)
/adddest here [nama] – simpan chat/topic saat ini
/adddest <chat_id>:<topic_id> [nama] – format gabungan
/listdest – daftar tujuan
/usedest <dest_id> – set default tujuan
/connectbot <token> – kaitkan bot milikmu
/listbot – daftar bot milikmu
/subscribe <owner/repo> [event1,event2,...] – buat webhook GitHub
/listsubs – daftar langgananmu
/unsubscribe <id> – hapus langganan

# Admin:
/whoami – cek peranmu
/promote <telegram_user_id>
/demote <telegram_user_id>
/listusers – semua user
/listsubs_all – semua subscription
/checkdest <dest_id> – cek status bot di chat
"""


def ensure_user(session, tg_user: dict) -> User:
    """
    Get or create a User row for a Telegram sender.

    It also syncs the admin flag if the user's Telegram ID appears in ADMIN_IDS.
    """
    uid = str(tg_user.get("id"))
    u = session.query(User).filter_by(telegram_user_id=uid).first()
    if not u:
        u = User(
            telegram_user_id=uid,
            username=tg_user.get("username") or "",
            first_seen_at=now_wib(),
            is_admin=(uid in ADMIN_IDS),
        )
        session.add(u)
        session.commit()
    else:
        # keep admin flag in sync with ENV
        if (uid in ADMIN_IDS) and not u.is_admin:
            u.is_admin = True
            session.commit()
    return u


@app.post("/tg/{bot_id}/{token}")
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
        return PlainTextResponse("ok")

    chat = msg.get("chat") or {}
    from_user = msg.get("from") or {}
    text = (msg.get("text") or "").strip()
    topic_id_from_msg = msg.get("message_thread_id")  # None if not a Topic
    chat_id_current = str(chat.get("id"))

    session = db()
    user = ensure_user(session, from_user)

    # Ensure Bot (from path)
    b = session.query(Bot).filter_by(bot_id=bot_id).first()
    if not b:
        b = Bot(owner_user_id=user.id, bot_id=bot_id, token=token)
        session.add(b)
        session.commit()
    else:
        if b.token != token:
            b.token = token
            session.commit()

    async def reply(s: str):
        """Reply back to the same chat (and topic if any) using the current bot token."""
        await tg_send(b.token, chat_id_current, s, topic_id=topic_id_from_msg)

    if not text or not text.startswith("/"):
        await reply("Gunakan perintah. /help")
        return PlainTextResponse("ok")

    cmd, *rest = text.split(maxsplit=1)
    arg = rest[0] if rest else ""

    # --------- User commands ----------
    if cmd == "/start":
        role = "admin" if user.is_admin else "user"
        await reply(f"Halo! Kamu *{role}*.\n{CMD_HELP}")
    elif cmd == "/help":
        await reply(CMD_HELP)

    elif cmd == "/connectbot":
        # Register an additional bot token for this user
        if not arg:
            await reply("Format: /connectbot <token_bot_telegram>")
        else:
            bid = parse_bot_id_from_token(arg)
            if not bid:
                await reply("Token tidak valid.")
            else:
                bot = session.query(Bot).filter_by(bot_id=bid).first()
                if not bot:
                    bot = Bot(owner_user_id=user.id, bot_id=bid, token=arg)
                    session.add(bot)
                else:
                    bot.owner_user_id = user.id
                    bot.token = arg
                session.commit()
                await reply(
                    "Bot terhubung ✅\n"
                    "Set webhook Telegram ke:\n"
                    f"`{PUBLIC_BASE_URL}/tg/{bid}/{arg}`"
                )

    elif cmd == "/listbot":
        # List this user's registered bot tokens
        bots = session.query(Bot).filter_by(owner_user_id=user.id).all()
        if not bots:
            await reply("Belum ada bot. /connectbot <token>")
        else:
            lines = ["Bot milikmu:"]
            for bt in bots:
                lines.append(f"- id=`{bt.bot_id}` dibuat={bt.created_at.isoformat()}")
            await reply("\n".join(lines))

    elif cmd == "/adddest":
        # Add a destination (current chat/topic or explicit chat_id[:topic_id])
        if not arg:
            await reply(
                "Format:\n/adddest <chat_id> [nama]\n"
                "/adddest here [nama]\n/adddest <chat_id>:<topic_id> [nama]"
            )
        else:
            parts = arg.split(maxsplit=1)
            title = parts[1] if len(parts) > 1 else ""
            destination_count = (
                session.query(Destination).filter_by(owner_user_id=user.id).count()
            )
            # 1) /adddest here
            if parts[0].lower() == "here":
                dest = Destination(
                    owner_user_id=user.id,
                    chat_id=chat_id_current,
                    title=title,
                    is_default=(destination_count == 0),
                    topic_id=topic_id_from_msg,  # set if Group Topic
                )
                session.add(dest)
                session.commit()
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
                    is_default=(destination_count == 0),
                    topic_id=topic_val,
                )
                session.add(dest)
                session.commit()
                await reply(
                    f"Destination ditambah. id={dest.id} chat_id={dest.chat_id} "
                    f"topic_id={dest.topic_id or '-'} default={dest.is_default}"
                )

    elif cmd == "/listdest":
        # List all destinations for this user
        dests = session.query(Destination).filter_by(owner_user_id=user.id).all()
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
        # Mark a specific destination as default
        if not arg or not arg.isdigit():
            await reply("Format: /usedest <dest_id>")
        else:
            did = int(arg)
            dest = (
                session.query(Destination)
                .filter_by(id=did, owner_user_id=user.id)
                .first()
            )
            if not dest:
                await reply("Destination tidak ditemukan.")
            else:
                session.query(Destination).filter_by(owner_user_id=user.id).update(
                    {"is_default": False}
                )
                dest.is_default = True
                session.commit()
                await reply(f"Default destination => id={dest.id}")

    elif cmd == "/subscribe":
        # Create a GitHub webhook subscription for a repo, binding the current user's bot+dest
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
                    session.query(Bot)
                    .filter_by(owner_user_id=user.id)
                    .order_by(Bot.id.desc())
                    .first()
                )
                if not bot:
                    await reply("Belum ada bot. /connectbot <token> dulu.")
                else:
                    dest = (
                        session.query(Destination)
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
                        session.add(sub)
                        session.commit()
                        payload_url = f"{PUBLIC_BASE_URL}/wh/{hook_id}"
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
        # List subscriptions owned by this user
        subs = session.query(Subscription).filter_by(owner_user_id=user.id).all()
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
        # Remove a subscription by ID
        if not arg or not arg.isdigit():
            await reply("Format: /unsubscribe <id>")
        else:
            sid = int(arg)
            s = (
                session.query(Subscription)
                .filter_by(id=sid, owner_user_id=user.id)
                .first()
            )
            if not s:
                await reply("Langganan tidak ditemukan.")
            else:
                session.delete(s)
                session.commit()
                await reply("Langganan dihapus.")

    elif cmd == "/testdest":
        # Send a test message to the default destination of this user
        dest = (
            session.query(Destination)
            .filter_by(owner_user_id=user.id, is_default=True)
            .first()
        )
        if not dest:
            await reply("Belum ada destination default.")
        else:
            await tg_send(
                b.token,
                dest.chat_id,
                "Test ke destination default.",
                topic_id=dest.topic_id,
            )
            await reply("Dikirim.")

    # --------- Admin commands ----------
    elif cmd == "/whoami":
        await reply(f"Kamu: *{'admin' if user.is_admin else 'user'}*")

    elif cmd == "/promote":
        # Promote a user to admin by their Telegram numeric user id
        if not user.is_admin:
            await reply("Hanya admin.")
        elif not arg:
            await reply("Format: /promote <telegram_user_id>")
        else:
            target = session.query(User).filter_by(telegram_user_id=arg.strip()).first()
            if not target:
                await reply("User tidak ditemukan.")
            else:
                target.is_admin = True
                session.commit()
                await reply(f"Promote sukses: {target.telegram_user_id} kini admin.")

    elif cmd == "/demote":
        # Demote a user back to non-admin
        if not user.is_admin:
            await reply("Hanya admin.")
        elif not arg:
            await reply("Format: /demote <telegram_user_id>")
        else:
            target = session.query(User).filter_by(telegram_user_id=arg.strip()).first()
            if not target:
                await reply("User tidak ditemukan.")
            else:
                target.is_admin = False
                session.commit()
                await reply(
                    f"Demote sukses: {target.telegram_user_id} kini user biasa."
                )

    elif cmd == "/listusers":
        # List all users (admin only)
        if not user.is_admin:
            await reply("Hanya admin.")
        else:
            us = session.query(User).order_by(User.id).all()
            lines = ["Users:"]
            for uu in us:
                flag = "👑" if uu.is_admin else " "
                lines.append(
                    f"{flag} id={uu.id} tg={uu.telegram_user_id} @{uu.username or '-'}"
                )
            await reply("\n".join(lines))

    elif cmd == "/listsubs_all":
        # List all subscriptions (admin only)
        if not user.is_admin:
            await reply("Hanya admin.")
        else:
            subs = session.query(Subscription).order_by(Subscription.id.desc()).all()
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
        # Check the bot's membership/admin status in a destination chat
        if not arg or not arg.isdigit():
            await reply("Format: /checkdest <dest_id>")
        else:
            d = (
                session.query(Destination)
                .filter_by(id=int(arg), owner_user_id=user.id)
                .first()
            )
            if not d:
                await reply("Destination tidak ditemukan.")
            else:
                url = f"https://api.telegram.org/bot{b.token}/getChatMember"
                bot_numeric_id = parse_bot_id_from_token(b.token)
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.get(
                        url, params={"chat_id": d.chat_id, "user_id": bot_numeric_id}
                    )
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

    return PlainTextResponse("ok")


# =============================================================================
# GitHub Webhook
# =============================================================================
@app.post("/wh/{hook_id}")
async def github_webhook(
    hook_id: str,
    request: Request,
    x_hub_signature_256: Optional[str] = Header(None),
    x_github_event: Optional[str] = Header(None),
):
    """
    GitHub webhook endpoint.

    The `hook_id` identifies a Subscription row containing the expected HMAC `secret`
    and the (bot, destination) pair to forward notifications to. The payload signature
    is validated against `X-Hub-Signature-256`.
    """
    body = await request.body()
    session = db()
    sub = session.query(Subscription).filter_by(hook_id=hook_id).first()
    if not sub:
        raise HTTPException(404, "Hook tidak ditemukan")

    if not gh_verify(sub.secret, body, x_hub_signature_256):
        raise HTTPException(401, "Signature tidak valid")

    payload = await request.json()
    event = x_github_event or "unknown"

    if sub.events_csv and sub.events_csv != "*":
        allowed = [e.strip() for e in sub.events_csv.split(",") if e.strip()]
        if event not in allowed:
            return PlainTextResponse("ignored")

    bot = session.query(Bot).filter_by(id=sub.bot_id).first()
    dest = session.query(Destination).filter_by(id=sub.destination_id).first()
    if not bot or not dest:
        raise HTTPException(500, "Bot atau destination tidak tersedia")

    text = pretty_github_event(event, payload)
    await tg_send(bot.token, dest.chat_id, text, topic_id=dest.topic_id)
    return PlainTextResponse("ok")


# -----------------------------------------------------------------------------
# HTTP Help & Setup Endpoints
# -----------------------------------------------------------------------------

HTTP_HELP_TEXT = dedent(
    f"""
GitHub → Telegram Notifier (HTTP Help)

Endpoints
---------
- GET  /            : Health check
- GET  /help        : Ringkasan perintah & endpoint
- GET  /setup       : Panduan setup end-to-end
- POST /tg/{{bot_id}}/{{token}} : Telegram webhook (per bot user)
- POST /wh/{{hook_id}}          : GitHub webhook (per subscription)

Perintah Telegram
-----------------
{CMD_HELP}

Catatan
-------
- PUBLIC_BASE_URL: {PUBLIC_BASE_URL}
- Semua waktu disimpan dalam WIB (Asia/Jakarta).
"""
).strip()


def _render_setup_markdown() -> str:
    base = PUBLIC_BASE_URL.rstrip("/")
    return dedent(
        f"""
    Setup Guide (Server & Webhook)

    1) Persiapan ENV (.env)
    -----------------------
    Buat file `.env` di root project:
    ```
    DB_URL=sqlite:///./github_tg.sqlite3
    PUBLIC_BASE_URL={base}
    ADMIN_USER_IDS=123456789,987654321
    ```

    2) Buat venv & install dependencies
    -----------------------------------
    ```
    python -m venv .venv
    source .venv/bin/activate
    pip install -U pip
    pip install fastapi uvicorn httpx sqlalchemy pydantic python-dotenv
    ```

    3) Jalankan aplikasi (contoh)
    -----------------------------
    ```
    uvicorn app:app --host 127.0.0.1 --port 8000 --workers=2 --proxy-headers --forwarded-allow-ips="*"
    ```

    4) Set webhook Telegram (tiap bot user)
    ---------------------------------------
    URL webhook Telegram:
    ```
    {base}/tg/{{bot_id}}/{{token}}
    ```
    Cara cepat (contoh curl):
    ```
    curl -s "https://api.telegram.org/bot{{token}}/setWebhook" \
      -d "url={base}/tg/{{bot_id}}/{{token}}"
    ```
    Setelah itu, di chat Telegram dengan bot:
    - /start
    - /adddest here
    - /subscribe owner/repo push,pull_request

    5) Buat webhook GitHub (per repo)
    ---------------------------------
    Setelah menjalankan /subscribe, bot akan mengirim konfigurasi seperti:
    - Payload URL: `{base}/wh/{{hook_id}}`
    - Content type: `application/json`
    - Secret: (acak per subscription)
    - Events: pilih sesuai kebutuhan (mis. Push, Pull Request)

    6) Reverse proxy (ringkas)
    --------------------------
    Nginx/OpenResty blok minimal:
    ```
    server {{
        listen 443 ssl http2;
        server_name yourdomain.example;

        ssl_certificate     /etc/letsencrypt/live/yourdomain.example/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/yourdomain.example/privkey.pem;

        client_max_body_size 5m;

        # Telegram webhook - matikan access_log agar token tidak terekam
        location ~ ^/tg/\\d+/.+ {{
            access_log off;
            proxy_pass http://127.0.0.1:8000;
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            limit_except POST {{ deny all; }}
        }}

        # GitHub webhook
        location /wh/ {{
            proxy_pass http://127.0.0.1:8000;
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            limit_except POST {{ deny all; }}
        }}

        # Health check
        location / {{
            proxy_pass http://127.0.0.1:8000;
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }}
    }}
    ```

    7) Tips Keamanan
    ----------------
    - Jangan log lengkap URL /tg/... karena mengandung token bot.
    - Simpan DB yang berisi token dengan aman (izin file/folder dibatasi).
    - Gunakan HTTPS untuk seluruh traffic publik.

    Referensi cepat
    ---------------
    - Health check: `GET {base}/`
    - Help HTTP:    `GET {base}/help`
    - Setup HTTP:   `GET {base}/setup`
    """
    ).strip()


@app.get("/help", response_class=PlainTextResponse)
def http_help():
    """
    HTTP help endpoint.
    Returns a plaintext cheat sheet of endpoints and Telegram commands.
    """
    return HTTP_HELP_TEXT


@app.get("/setup", response_class=PlainTextResponse)
def http_setup():
    """
    HTTP setup endpoint.
    Returns a plaintext end-to-end setup guide.
    """
    return _render_setup_markdown()


# =============================================================================
# Root
# =============================================================================
@app.get("/", response_class=PlainTextResponse)
def root():
    """
    Simple liveness endpoint.
    """
    return "Hello World!"
