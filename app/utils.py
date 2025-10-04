"""the beautiful world start from here."""

from __future__ import annotations

import hashlib
import hmac

CMD_HELP = """Commands:
/start – register yourself and check role
/adddest <chat_id> [name] – add a destination (PM/Group/Channel)
/adddest here [name] – store the current chat/topic
/adddest <chat_id>:<topic_id> [name] – combined format
/listdest – list your destinations
/usedest <dest_id> – set the default destination
/connectbot <token> – link your Telegram bot
/listbot – list your bots
/subscribe <owner/repo> [event1,event2,...] – create a GitHub webhook subscription
/listsubs – list your subscriptions
/unsubscribe <id> – remove a subscription

# Admin:
/whoami – show your role
/promote <telegram_user_id> – promote a user to admin
/demote <telegram_user_id> – demote a user
/listusers – list every user
/listsubs_all – list every subscription
/checkdest <dest_id> – verify bot status in a chat
"""


def parse_bot_id_from_token(token: str) -> str | None:
    """
    Extract the numeric bot ID from a Telegram bot token.

    Example
    -------
    '123456789:AA...' → '123456789'
    """
    return token.split(":", 1)[0] if ":" in token else None


def gh_verify(secret: str, body: bytes, signature_header: str | None) -> bool:
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


def parse_topic_id(s: str) -> int | None:
    """Return a positive int topic_id or None if invalid."""
    try:
        v = int(s)
        return v if v > 0 else None
    except (ValueError, TypeError):
        return None
