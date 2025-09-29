"""the beautiful world start from here."""

from __future__ import annotations

import hashlib
import hmac

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


def mdv2_escape(s: str) -> str:
    """
    Escape special characters for Telegram MarkdownV2 to prevent formatting issues.
    """
    for ch in r"_*[]()~`>#+-=|{}.!":
        s = s.replace(ch, f"\\{ch}")
    return s


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
