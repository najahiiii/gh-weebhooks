"""Telegram router with inline-button workflow."""

from __future__ import annotations

import json
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from html import escape as _esc_html
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import Bot, Destination, Subscription, User
from app.schemas import TgUpdate
from app.services.telegram import (
    answer_callback_query,
    edit_message_text,
    get_chat_member,
    send_message,
)
from app.utils import CMD_HELP, parse_bot_id_from_token, parse_topic_id

router = APIRouter(prefix="/tg", tags=["telegram"])


def _esc(value: Any) -> str:
    return _esc_html(str(value or ""), quote=True)


def _code(value: Any) -> str:
    return f"<code>{_esc(value)}</code>"


def _pre(value: Any) -> str:
    return f"<pre>{_esc(value)}</pre>"


def _compose_message(
    title: str,
    body: list[str] | str | None = None,
    *,
    include_footer: bool = True,
) -> str:
    lines: list[str] = [title.strip()]
    if body:
        body_lines = [body] if isinstance(body, str) else list(body)
        lines.append("")
        lines.extend(line.strip("\n") for line in body_lines)
    if include_footer:
        lines.append("")
        lines.append("Use the buttons below to continue.")
    return "\n".join(lines)


PENDING_TTL = timedelta(minutes=5)
PendingKey = tuple[str, str]


@dataclass
class PendingAction:
    command: str
    created_at: datetime


def ensure_user(db: Session, tg_user: dict[str, Any]) -> User:
    """Fetch or create a user record for the Telegram sender."""

    uid = str(tg_user.get("id"))
    user = db.query(User).filter_by(telegram_user_id=uid).first()
    is_admin = uid in settings.admin_ids

    if not user:
        user = User(
            telegram_user_id=uid,
            username=tg_user.get("username") or "",
            is_admin=is_admin,
        )
        db.add(user)
        db.commit()
    elif is_admin and not user.is_admin:
        user.is_admin = True
        db.commit()

    return user


@dataclass
class CommandContext:
    db: Session
    bot: Bot
    user: User
    chat_id: str
    topic_id: Optional[int]
    message_id: Optional[int]
    display_name: str

    async def reply(
        self,
        text: str,
        *,
        markup: Optional[dict[str, Any]] = None,
        auto_split: bool = True,
        prefer_edit: bool = False,
    ) -> None:
        can_edit = (
            prefer_edit
            and self.message_id is not None
            and not auto_split
            and len(text) <= 4096
        )
        if can_edit:
            await edit_message_text(
                self.bot.token,
                self.chat_id,
                self.message_id,
                text,
                disable_web_page_preview=True,
                reply_markup=markup,
            )
            return

        await send_message(
            self.bot.token,
            self.chat_id,
            text,
            topic_id=self.topic_id,
            disable_web_page_preview=True,
            auto_split=auto_split,
            reply_markup=markup,
        )

    @property
    def is_owner(self) -> bool:
        return self.bot.owner_user_id == self.user.id

    @property
    def token(self) -> str:
        return self.bot.token


_PENDING_ACTIONS: dict[PendingKey, PendingAction] = {}

PROMPTS: dict[str, str] = {
    "/connectbot": "Share the Telegram bot token you want to link.",
    "/adddest": (
        "Send the destination in one of these formats:\n"
        "• <code>chat_id [name]</code>\n"
        "• <code>chat_id:topic_id [name]</code>\n"
        "• <code>here [name]</code> to use this chat/topic"
    ),
    "/usedest": "Send the destination ID you want to mark as default.",
    "/subscribe": (
        "Send the repository and optional events, for example:\n"
        "<code>octocat/Hello-World push,pull_request</code>"
    ),
    "/unsubscribe": "Send the subscription ID you want to remove.",
    "/checkdest": "Send the destination ID to verify bot permissions.",
    "/promote": "Send the Telegram user ID you want to promote to admin.",
    "/demote": "Send the Telegram user ID you want to demote to regular user.",
}

ALLOWED_FOR_GUESTS = {"/start", "/help", "/menu", "/whoami"}


def _pending_key(user: User, bot: Bot) -> PendingKey:
    return (user.telegram_user_id or "", bot.bot_id or "")


def _get_pending(ctx: CommandContext) -> Optional[PendingAction]:
    key = _pending_key(ctx.user, ctx.bot)
    pending = _PENDING_ACTIONS.get(key)
    if not pending:
        return None
    if datetime.utcnow() - pending.created_at > PENDING_TTL:
        _PENDING_ACTIONS.pop(key, None)
        return None
    return pending


def _set_pending(ctx: CommandContext, command: str) -> None:
    key = _pending_key(ctx.user, ctx.bot)
    _PENDING_ACTIONS[key] = PendingAction(command=command, created_at=datetime.utcnow())


def _clear_pending(ctx: CommandContext) -> None:
    _PENDING_ACTIONS.pop(_pending_key(ctx.user, ctx.bot), None)


def _callback_payload(command: str, *, arg: str | None = None, require_input: bool = False) -> str:
    payload: dict[str, Any] = {"c": command}
    if arg:
        payload["a"] = arg
    if require_input:
        payload["i"] = 1
    return json.dumps(payload, separators=(",", ":"))


def _cancel_markup() -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [{"text": "Cancel", "callback_data": _callback_payload("/cancel")}]
        ]
    }


def _build_main_menu(ctx: CommandContext) -> dict[str, Any]:
    buttons: list[list[dict[str, str]]] = []
    if ctx.is_owner or ctx.user.is_admin:
        buttons.extend(
            [
                [
                    {
                        "text": "Connect bot",
                        "callback_data": _callback_payload("/connectbot", require_input=True),
                    },
                    {
                        "text": "List bots",
                        "callback_data": _callback_payload("/listbot"),
                    },
                ],
                [
                    {
                        "text": "Add destination",
                        "callback_data": _callback_payload("/adddest", require_input=True),
                    },
                    {
                        "text": "List destinations",
                        "callback_data": _callback_payload("/listdest"),
                    },
                ],
                [
                    {
                        "text": "Set default destination",
                        "callback_data": _callback_payload("/usedest", require_input=True),
                    },
                    {
                        "text": "Test destination",
                        "callback_data": _callback_payload("/testdest"),
                    },
                ],
                [
                    {
                        "text": "Subscribe repository",
                        "callback_data": _callback_payload("/subscribe", require_input=True),
                    },
                    {
                        "text": "List subscriptions",
                        "callback_data": _callback_payload("/listsubs"),
                    },
                ],
                [
                    {
                        "text": "Unsubscribe",
                        "callback_data": _callback_payload("/unsubscribe", require_input=True),
                    },
                    {
                        "text": "Who am I",
                        "callback_data": _callback_payload("/whoami"),
                    },
                ],
                [
                    {
                        "text": "Show help",
                        "callback_data": _callback_payload("/help"),
                    }
                ],
            ]
        )
        if ctx.user.is_admin:
            buttons.extend(
                [
                    [
                        {
                            "text": "Promote user",
                            "callback_data": _callback_payload("/promote", require_input=True),
                        },
                        {
                            "text": "Demote user",
                            "callback_data": _callback_payload("/demote", require_input=True),
                        },
                    ],
                    [
                        {
                            "text": "List users",
                            "callback_data": _callback_payload("/listusers"),
                        },
                        {
                            "text": "All subscriptions",
                            "callback_data": _callback_payload("/listsubs_all"),
                        },
                    ],
                    [
                        {
                            "text": "Check destination",
                            "callback_data": _callback_payload("/checkdest", require_input=True),
                        }
                    ],
                ]
            )
    else:
        buttons.extend(
            [
                [
                    {
                        "text": "Show help",
                        "callback_data": _callback_payload("/help"),
                    }
                ],
                [
                    {
                        "text": "Who am I",
                        "callback_data": _callback_payload("/whoami"),
                    }
                ],
            ]
        )
    if _get_pending(ctx):
        buttons.append(
            [
                {
                    "text": "Cancel pending input",
                    "callback_data": _callback_payload("/cancel"),
                }
            ]
        )
    return {"inline_keyboard": buttons}


def _subscriptions_markup(subs: list[Subscription]) -> dict[str, Any]:
    keyboard = [
        [
            {
                "text": f"#{sub.id} {sub.repo}",
                "callback_data": _callback_payload("/subinfo", arg=str(sub.id)),
            }
        ]
        for sub in subs
    ]
    keyboard.append(
        [{"text": "Back to menu", "callback_data": _callback_payload("/menu")}]
    )
    return {"inline_keyboard": keyboard}


async def _send_main_menu(ctx: CommandContext, *, heading: str | None = None) -> None:
    greeting = heading or f"Hi {ctx.display_name} 👋"
    if ctx.is_owner or ctx.user.is_admin:
        intro = "What would you like to manage today?"
    else:
        intro = "You can explore the help menu or check your role."
    text = _compose_message(greeting, intro)
    await ctx.reply(
        text,
        markup=_build_main_menu(ctx),
        auto_split=False,
        prefer_edit=True,
    )


async def _request_input(ctx: CommandContext, command: str) -> None:
    _set_pending(ctx, command)
    prompt = PROMPTS.get(command, "Send the required value.")
    text = (
        f"✏️ {prompt}\n\n"
        "Send it as a single message. Tap Cancel if you changed your mind."
    )
    await ctx.reply(
        text,
        markup=_cancel_markup(),
        auto_split=False,
        prefer_edit=True,
    )


async def _menu_response(
    ctx: CommandContext,
    title: str,
    body: list[str] | str | None = None,
    *,
    include_footer: bool = True,
) -> None:
    message = _compose_message(title, body, include_footer=include_footer)
    await ctx.reply(
        message,
        markup=_build_main_menu(ctx),
        auto_split=False,
        prefer_edit=True,
    )


async def _handle_start(ctx: CommandContext, _arg: str) -> None:
    role = "admin" if ctx.user.is_admin else "user"
    await _send_main_menu(ctx, heading=f"Hi! You are <b>{_esc(role)}</b>.")


async def _handle_help(ctx: CommandContext, _arg: str) -> None:
    await _menu_response(ctx, "Help", [_pre(CMD_HELP)], include_footer=False)


async def _handle_connectbot(ctx: CommandContext, arg: str) -> None:
    if not arg:
        await _request_input(ctx, "/connectbot")
        return

    token = arg.strip()
    bot_id = parse_bot_id_from_token(token)
    if not bot_id:
        await ctx.reply(
            _compose_message(
                "⚠️ That token looks invalid",
                "Please double-check the value and send it again.",
            ),
            markup=_cancel_markup(),
            auto_split=False,
            prefer_edit=True,
        )
        _set_pending(ctx, "/connectbot")
        return

    bot = ctx.db.query(Bot).filter_by(bot_id=bot_id).first()
    if not bot:
        bot = Bot(owner_user_id=ctx.user.id, bot_id=bot_id, token=token)
        ctx.db.add(bot)
    else:
        bot.owner_user_id = ctx.user.id
        bot.token = token
    ctx.db.commit()

    webhook = f"{settings.public_base_url}/tg/{bot_id}/{token}"
    body = [
        f"Webhook URL: {_code(webhook)}",
        "Set it as the bot's webhook so GitHub updates can be delivered.",
    ]
    await _menu_response(ctx, "✅ Bot connected", body)


async def _handle_listbot(ctx: CommandContext, _arg: str) -> None:
    bots = ctx.db.query(Bot).filter_by(owner_user_id=ctx.user.id).all()
    if not bots:
        await _menu_response(
            ctx,
            "🤖 No bots yet",
            "Tap Connect bot to link one.",
        )
        return
    body = ["Linked bots:"] + [
        f"• id={_code(bot.bot_id)} created={_code(bot.created_at.isoformat())}"
        for bot in bots
    ]
    await _menu_response(ctx, "🤖 Your bots", body)


async def _handle_adddest(ctx: CommandContext, arg: str) -> None:
    if not arg:
        await _request_input(ctx, "/adddest")
        return

    parts = arg.split(maxsplit=1)
    label = parts[1] if len(parts) > 1 else ""
    dest_count = ctx.db.query(Destination).filter_by(owner_user_id=ctx.user.id).count()

    if parts[0].lower() == "here":
        destination = Destination(
            owner_user_id=ctx.user.id,
            chat_id=ctx.chat_id,
            title=label,
            is_default=(dest_count == 0),
            topic_id=ctx.topic_id,
        )
    else:
        chat_part = parts[0]
        topic_value = None
        if ":" in chat_part:
            chat_part, topic_raw = chat_part.split(":", 1)
            topic_value = parse_topic_id(topic_raw)
        destination = Destination(
            owner_user_id=ctx.user.id,
            chat_id=chat_part,
            title=label,
            is_default=(dest_count == 0),
            topic_id=topic_value,
        )
    ctx.db.add(destination)
    ctx.db.commit()

    body = [
        f"ID: {_code(destination.id)}",
        f"Chat: {_code(destination.chat_id)}",
        f"Topic: {_code(destination.topic_id or '-')}",
        f"Default: {_code(destination.is_default)}",
    ]
    await _menu_response(ctx, "📬 Destination saved", body)


async def _handle_listdest(ctx: CommandContext, _arg: str) -> None:
    dests = ctx.db.query(Destination).filter_by(owner_user_id=ctx.user.id).all()
    if not dests:
        await _menu_response(
            ctx,
            "📪 No destinations yet",
            "Add one to choose where GitHub events are sent.",
        )
        return
    body = [
        (
            f"{'⭐' if dest.is_default else '•'} id={_code(dest.id)} "
            f"chat={_code(dest.chat_id)} topic={_code(dest.topic_id or '-')} "
            f"{_esc(dest.title or '')}"
        )
        for dest in dests
    ]
    await _menu_response(ctx, "📬 Destinations", body)


async def _handle_usedest(ctx: CommandContext, arg: str) -> None:
    if not arg or not arg.isdigit():
        await _request_input(ctx, "/usedest")
        return

    dest = (
        ctx.db.query(Destination)
        .filter_by(id=int(arg), owner_user_id=ctx.user.id)
        .first()
    )
    if not dest:
        await ctx.reply(
            _compose_message(
                "❓ Destination not found",
                "Send another ID or tap Cancel.",
            ),
            markup=_cancel_markup(),
            auto_split=False,
            prefer_edit=True,
        )
        _set_pending(ctx, "/usedest")
        return

    ctx.db.query(Destination).filter_by(owner_user_id=ctx.user.id).update(
        {"is_default": False}
    )
    dest.is_default = True
    ctx.db.commit()
    await _menu_response(
        ctx,
        "⭐ Default destination updated",
        f"Destination {_code(dest.id)} is now the default.",
    )


async def _handle_subscribe(ctx: CommandContext, arg: str) -> None:
    if not arg:
        await _request_input(ctx, "/subscribe")
        return

    parts = arg.split(maxsplit=1)
    repo = parts[0].strip()
    events_csv = (parts[1].strip() if len(parts) > 1 else "*") or "*"
    if "/" not in repo:
        await ctx.reply(
            _compose_message(
                "⚠️ Invalid repository format",
                "Use <code>owner/repo</code> (for example <code>octocat/Hello-World</code>).",
            ),
            markup=_cancel_markup(),
            auto_split=False,
            prefer_edit=True,
        )
        _set_pending(ctx, "/subscribe")
        return

    bot = (
        ctx.db.query(Bot)
        .filter_by(owner_user_id=ctx.user.id)
        .order_by(Bot.id.desc())
        .first()
    )
    if not bot:
        await _menu_response(
            ctx,
            "🤖 No bot connected",
            "Link one via Connect bot before creating subscriptions.",
        )
        return

    dest = (
        ctx.db.query(Destination)
        .filter_by(owner_user_id=ctx.user.id, is_default=True)
        .first()
    )
    if not dest:
        await _menu_response(
            ctx,
            "📪 No default destination",
            "Add one and mark it as default before subscribing.",
        )
        return

    hook_id = uuid.uuid4().hex
    secret = uuid.uuid4().hex
    subscription = Subscription(
        owner_user_id=ctx.user.id,
        hook_id=hook_id,
        secret=secret,
        repo=repo,
        events_csv=events_csv,
        bot_id=bot.id,
        destination_id=dest.id,
    )
    ctx.db.add(subscription)
    ctx.db.commit()

    payload_url = f"{settings.public_base_url}/wh/{hook_id}"
    body = [
        f"ID: {_code(subscription.id)}",
        f"Repository: {_code(repo)}",
        f"Events: {_code(events_csv)}",
        "",
        "GitHub webhook settings:",
        f"• Payload URL: {_code(payload_url)}",
        f"• Content type: {_code('application/json')}",
        f"• Secret: {_code(secret)}",
        "• Choose events to match your subscription.",
    ]
    await _menu_response(ctx, "✅ Subscription created", body)


async def _handle_listsubs(ctx: CommandContext, _arg: str) -> None:
    subs = ctx.db.query(Subscription).filter_by(owner_user_id=ctx.user.id).all()
    if not subs:
        await _menu_response(ctx, "📭 No subscriptions yet", "Create one to receive GitHub updates.")
        return
    message = _compose_message(
        "📡 Your subscriptions",
        "Pick one below to view its details or unsubscribe.",
        include_footer=False,
    )
    await ctx.reply(
        message,
        markup=_subscriptions_markup(subs),
        auto_split=False,
        prefer_edit=True,
    )


async def _handle_subinfo(ctx: CommandContext, arg: str) -> None:
    if not arg or not arg.isdigit():
        await _handle_listsubs(ctx, "")
        return
    sub = (
        ctx.db.query(Subscription)
        .filter_by(id=int(arg), owner_user_id=ctx.user.id)
        .first()
    )
    if not sub:
        await _menu_response(
            ctx,
            "❓ Subscription not found",
            "Try selecting a subscription from the list again.",
        )
        return
    payload_url = f"{settings.public_base_url}/wh/{sub.hook_id}"
    body = [
        f"ID: {_code(sub.id)}",
        f"Repository: {_code(sub.repo)}",
        f"Events: {_esc(sub.events_csv)}",
        f"Hook: {_code('/wh/' + sub.hook_id)}",
        "",
        "GitHub webhook settings:",
        f"• Payload URL: {_code(payload_url)}",
        f"• Content type: {_code('application/json')}",
        f"• Secret: {_code(sub.secret)}",
    ]
    markup = {
        "inline_keyboard": [
            [
                {
                    "text": "Unsubscribe",
                    "callback_data": _callback_payload("/unsubscribe", arg=str(sub.id)),
                }
            ],
            [
                {
                    "text": "Back to subscriptions",
                    "callback_data": _callback_payload("/listsubs"),
                }
            ],
            [
                {
                    "text": "Back to menu",
                    "callback_data": _callback_payload("/menu"),
                }
            ],
        ]
    }
    await ctx.reply(
        _compose_message("📡 Subscription details", body, include_footer=False),
        markup=markup,
        auto_split=False,
        prefer_edit=True,
    )


async def _handle_unsubscribe(ctx: CommandContext, arg: str) -> None:
    if not arg or not arg.isdigit():
        await _request_input(ctx, "/unsubscribe")
        return
    sub = (
        ctx.db.query(Subscription)
        .filter_by(id=int(arg), owner_user_id=ctx.user.id)
        .first()
    )
    if not sub:
        await ctx.reply(
            _compose_message(
                "❓ Subscription not found",
                "Send another ID or tap Cancel.",
            ),
            markup=_cancel_markup(),
            auto_split=False,
            prefer_edit=True,
        )
        _set_pending(ctx, "/unsubscribe")
        return
    ctx.db.delete(sub)
    ctx.db.commit()
    await _menu_response(ctx, "🗑️ Subscription removed", f"Subscription {_code(sub.id)} is gone.")


async def _handle_testdest(ctx: CommandContext, _arg: str) -> None:
    dest = (
        ctx.db.query(Destination)
        .filter_by(owner_user_id=ctx.user.id, is_default=True)
        .first()
    )
    if not dest:
        await _menu_response(
            ctx,
            "📪 No default destination",
            "Add one before sending a test message.",
        )
        return
    await send_message(
        ctx.bot.token,
        dest.chat_id,
        "Test message to the default destination.",
        topic_id=dest.topic_id,
        auto_split=False,
    )
    await _menu_response(
        ctx,
        "✅ Test message sent",
        "Check the destination chat for the notification.",
    )


async def _handle_whoami(ctx: CommandContext, _arg: str) -> None:
    role = "admin" if ctx.user.is_admin else "user"
    await _menu_response(ctx, "👤 Your role", f"You are <b>{_esc(role)}</b>.")


async def _handle_promote(ctx: CommandContext, arg: str) -> None:
    if not ctx.user.is_admin:
        await _menu_response(ctx, "🚫 Admins only", "Ask an administrator to perform this action.")
        return
    if not arg:
        await _request_input(ctx, "/promote")
        return
    target = ctx.db.query(User).filter_by(telegram_user_id=arg.strip()).first()
    if not target:
        await ctx.reply(
            _compose_message(
                "❓ User not found",
                "Send another Telegram user ID or tap Cancel.",
            ),
            markup=_cancel_markup(),
            auto_split=False,
            prefer_edit=True,
        )
        _set_pending(ctx, "/promote")
        return
    target.is_admin = True
    ctx.db.commit()
    await _menu_response(
        ctx,
        "✅ User promoted",
        f"{_code(target.telegram_user_id)} now has admin access.",
    )


async def _handle_demote(ctx: CommandContext, arg: str) -> None:
    if not ctx.user.is_admin:
        await _menu_response(ctx, "🚫 Admins only", "Ask an administrator to perform this action.")
        return
    if not arg:
        await _request_input(ctx, "/demote")
        return
    target = ctx.db.query(User).filter_by(telegram_user_id=arg.strip()).first()
    if not target:
        await ctx.reply(
            _compose_message(
                "❓ User not found",
                "Send another Telegram user ID or tap Cancel.",
            ),
            markup=_cancel_markup(),
            auto_split=False,
            prefer_edit=True,
        )
        _set_pending(ctx, "/demote")
        return
    target.is_admin = False
    ctx.db.commit()
    await _menu_response(
        ctx,
        "✅ User demoted",
        f"{_code(target.telegram_user_id)} is now a regular user.",
    )


async def _handle_listusers(ctx: CommandContext, _arg: str) -> None:
    if not ctx.user.is_admin:
        await _menu_response(ctx, "🚫 Admins only", "Ask an administrator to perform this action.")
        return
    users = ctx.db.query(User).order_by(User.id).all()
    body = [
        (
            f"{'👑' if usr.is_admin else '•'} id={_code(usr.id)} "
            f"tg={_code(usr.telegram_user_id)} {('@' + usr.username) if usr.username else '-'}"
        )
        for usr in users
    ]
    await _menu_response(ctx, "🧑‍🤝‍🧑 Users", body)


async def _handle_listsubs_all(ctx: CommandContext, _arg: str) -> None:
    if not ctx.user.is_admin:
        await _menu_response(ctx, "🚫 Admins only", "Ask an administrator to perform this action.")
        return
    subs = ctx.db.query(Subscription).order_by(Subscription.id.desc()).all()
    if not subs:
        await _menu_response(ctx, "📭 No subscriptions yet", "No one has subscribed so far.")
        return
    body = [
        (
            f"#{_code(sub.id)} owner={_code(sub.owner_user_id)} {_esc(sub.repo)} "
            f"events={_esc(sub.events_csv)} hook={_code('/wh/' + sub.hook_id)}"
        )
        for sub in subs
    ]
    await _menu_response(ctx, "🌐 All subscriptions", body)


async def _handle_checkdest(ctx: CommandContext, arg: str) -> None:
    if not arg or not arg.isdigit():
        await _request_input(ctx, "/checkdest")
        return
    destination = (
        ctx.db.query(Destination)
        .filter_by(id=int(arg), owner_user_id=ctx.user.id)
        .first()
    )
    if not destination:
        await ctx.reply(
            _compose_message(
                "❓ Destination not found",
                "Send another destination ID or tap Cancel.",
            ),
            markup=_cancel_markup(),
            auto_split=False,
            prefer_edit=True,
        )
        _set_pending(ctx, "/checkdest")
        return
    bot_numeric_id = parse_bot_id_from_token(ctx.bot.token)
    if not bot_numeric_id:
        await _menu_response(
            ctx,
            "⚠️ Cannot determine bot ID",
            "The bot token looks invalid. Try reconnecting the bot.",
        )
        return
    data = await get_chat_member(ctx.bot.token, destination.chat_id, bot_numeric_id)
    status = (data.get("result") or {}).get("status") if data.get("ok") else None
    if not data.get("ok"):
        body = (
            f"Error {_code(data.get('error_code', '???'))}:"
            f" {_esc(data.get('description', 'Unknown error'))}"
        )
        await _menu_response(ctx, "⚠️ Unable to verify", body)
        return
    await _menu_response(
        ctx,
        "✅ Bot status",
        f"Bot is <b>{_esc(status or 'unknown')}</b>. Channels require administrator rights.",
    )


async def _handle_menu(ctx: CommandContext, _arg: str) -> None:
    await _send_main_menu(ctx)


async def _handle_cancel(ctx: CommandContext, _arg: str) -> None:
    if _get_pending(ctx):
        _clear_pending(ctx)
        await _menu_response(ctx, "✅ Cancelled", "Pending input cleared.")
    else:
        await _menu_response(ctx, "ℹ️ Nothing to cancel", "You had no pending input.")


COMMAND_HANDLERS: dict[str, Callable[[CommandContext, str], Awaitable[None]]] = {
    "/start": _handle_start,
    "/help": _handle_help,
    "/connectbot": _handle_connectbot,
    "/listbot": _handle_listbot,
    "/adddest": _handle_adddest,
    "/listdest": _handle_listdest,
    "/usedest": _handle_usedest,
    "/subscribe": _handle_subscribe,
    "/listsubs": _handle_listsubs,
    "/subinfo": _handle_subinfo,
    "/unsubscribe": _handle_unsubscribe,
    "/testdest": _handle_testdest,
    "/whoami": _handle_whoami,
    "/promote": _handle_promote,
    "/demote": _handle_demote,
    "/listusers": _handle_listusers,
    "/listsubs_all": _handle_listsubs_all,
    "/checkdest": _handle_checkdest,
    "/menu": _handle_menu,
    "/cancel": _handle_cancel,
}


async def _process_command(
    ctx: CommandContext,
    command: str,
    argument: str,
    *,
    source: str,
) -> None:
    command = command.lower()
    if command not in COMMAND_HANDLERS:
        await _menu_response(
            ctx,
            "🤔 I don't know that command",
            "Use the buttons or /help to see available actions.",
        )
        return

    if source != "pending":
        _clear_pending(ctx)

    if not (ctx.is_owner or ctx.user.is_admin) and command not in ALLOWED_FOR_GUESTS:
        await _menu_response(
            ctx,
            "❌ Access denied",
            "Ask the bot owner for access or use your own bot.",
        )
        return

    handler = COMMAND_HANDLERS[command]
    await handler(ctx, argument)


@router.post("/{bot_id}/{token}", response_class=PlainTextResponse)
async def telegram_webhook(bot_id: str, token: str, upd: TgUpdate):
    payload = upd.dict()
    print(
        "[TG] update:",
        json.dumps(
            {
                "has_message": bool(payload.get("message")),
                "has_callback": bool(payload.get("callback_query")),
                "has_channel_post": bool(payload.get("channel_post")),
            },
            ensure_ascii=False,
        ),
    )

    callback = payload.get("callback_query")
    message = (
        payload.get("message")
        or payload.get("edited_message")
        or payload.get("channel_post")
    )

    if not callback and not message:
        return "ok"

    chat = (callback or {}).get("message", {}).get("chat") if callback else (message or {}).get("chat")
    if not chat:
        return "ok"
    chat_id_current = str(chat.get("id"))

    from_user = (callback or {}).get("from") if callback else (message or {}).get("from")
    if not from_user:
        return "ok"

    text = (message.get("text") or "").strip() if message else ""
    callback_message = callback.get("message") if callback else None
    if callback:
        topic_id = (callback_message or {}).get("message_thread_id")
    else:
        topic_id = message.get("message_thread_id") if message else None
    message_id = (callback_message or {}).get("message_id") if callback_message else None
    first_name = (from_user.get("first_name") or "").strip()
    last_name = (from_user.get("last_name") or "").strip()
    if first_name or last_name:
        display_name = f"{first_name} {last_name}".strip()
    else:
        display_name = from_user.get("username") or "there"

    with SessionLocal() as db:
        user = ensure_user(db, from_user)
        bot_record = db.query(Bot).filter_by(bot_id=bot_id).first()

        is_admin = bool(user.is_admin)
        is_owner = bool(bot_record and bot_record.owner_user_id == user.id)

        if bot_record and (bot_record.token != token) and not (is_owner or is_admin):
            return "ok"

        if not bot_record:
            bot_record = Bot(owner_user_id=user.id, bot_id=bot_id, token=token)
            db.add(bot_record)
            db.commit()
        elif bot_record.token != token:
            if is_owner or is_admin:
                bot_record.token = token
                db.commit()
            else:
                return "ok"

        ctx = CommandContext(
            db=db,
            bot=bot_record,
            user=user,
            chat_id=chat_id_current,
            topic_id=topic_id,
            message_id=message_id,
            display_name=display_name,
        )

        if callback:
            data_raw = callback.get("data") or ""
            try:
                data = json.loads(data_raw)
            except json.JSONDecodeError:
                data = {}
            await answer_callback_query(bot_record.token, callback.get("id"))

            command = data.get("c")
            argument = data.get("a", "")
            require_input = bool(data.get("i"))

            if not command:
                return "ok"
            if require_input:
                await _request_input(ctx, command)
            else:
                await _process_command(ctx, command, argument, source="callback")
            return "ok"

        if text.startswith("/"):
            command, *rest = text.split(maxsplit=1)
            argument = rest[0] if rest else ""
            await _process_command(ctx, command, argument, source="message")
            return "ok"

        pending = _get_pending(ctx)
        if pending and text:
            _clear_pending(ctx)
            await _process_command(ctx, pending.command, text, source="pending")

    return "ok"
