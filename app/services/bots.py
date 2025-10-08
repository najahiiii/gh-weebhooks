"""Services for managing Telegram bot registrations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Bot
from app.services.telegram import set_telegram_webhook
from app.services.users import ensure_user_by_tg_id
from app.utils import parse_bot_id_from_token


class BotSetupError(ValueError):
    """Raised when a bot cannot be registered due to invalid input."""


@dataclass
class BotSetupResult:
    bot: Bot
    owner_tg_id: str
    bot_id: str
    base_url: str
    webhook_result: dict


async def register_bot(
    session: Session,
    token: str,
    owner_tg_id: str,
    *,
    public_base_url: Optional[str] = None,
) -> BotSetupResult:
    """
    Ensure the owner exists (and is marked admin), store/update the bot token,
    and configure the Telegram webhook.
    """

    bot_id = parse_bot_id_from_token(token)
    if not bot_id:
        raise BotSetupError("Invalid token format.")

    owner = ensure_user_by_tg_id(session, owner_tg_id)
    if not owner.is_admin:
        owner.is_admin = True
        session.commit()

    bot = session.query(Bot).filter_by(bot_id=bot_id).first()
    if not bot:
        bot = Bot(owner_user_id=owner.id, bot_id=bot_id, token=token)
        session.add(bot)
    else:
        bot.owner_user_id = owner.id
        bot.token = token
    session.commit()

    base = (public_base_url or settings.public_base_url).rstrip("/")
    webhook_result = await set_telegram_webhook(token, bot_id, base)

    return BotSetupResult(
        bot=bot,
        owner_tg_id=owner_tg_id,
        bot_id=bot_id,
        base_url=base,
        webhook_result=webhook_result,
    )
