"""DB Schemas"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class TgUpdate(BaseModel):
    """
    Minimal model for Telegram Update.
    Only fields used by this app are included.
    """

    update_id: Optional[int] = None
    message: Optional[dict] = None
    edited_message: Optional[dict] = None
    channel_post: Optional[dict] = None
    callback_query: Optional[dict] = None

    class Config:
        extra = "allow"
