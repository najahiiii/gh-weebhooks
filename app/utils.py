"""the beautiful world start from here."""

from __future__ import annotations

import hashlib
import hmac

CMD_HELP = """Manage everything from the web UI:
- Sign in via /auth/login in your browser.
- Add bots from the Add Bot page and install their webhooks.
- Register destinations and subscriptions under the Admin dashboard.

The Telegram bot is outbound-only and no longer accepts chat commands."""


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
