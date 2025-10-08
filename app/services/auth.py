"""Auth helper utilities."""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Mapping

TELEGRAM_LOGIN_TTL_SECONDS = 5 * 60  # 5 minutes


def verify_telegram_login(data: Mapping[str, object], bot_token: str) -> bool:
    """
    Verify Telegram login payload as documented in
    https://core.telegram.org/widgets/login#checking-authorization.
    """
    if not bot_token:
        return False

    provided_hash = str(data.get("hash", ""))
    if not provided_hash:
        return False

    try:
        auth_date = int(data.get("auth_date", 0))
    except (TypeError, ValueError):
        return False

    if abs(int(time.time()) - auth_date) > TELEGRAM_LOGIN_TTL_SECONDS:
        return False

    check_data = {
        key: value
        for key, value in data.items()
        if key != "hash" and value is not None
    }
    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(check_data.items())
    )

    secret_key = hashlib.sha256(bot_token.encode()).digest()
    hmac_hash = hmac.new(
        secret_key,
        data_check_string.encode(),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(hmac_hash, provided_hash)
