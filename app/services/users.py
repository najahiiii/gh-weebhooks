"""Yet another users services"""

from sqlalchemy.orm import Session
from app.models import User
from app.config import settings
from app.timezone import now_wib

ADMIN_USER_IDS = settings.admin_ids


def ensure_user_by_tg_id(session: Session, tg_user_id: str) -> User:
    """
    Get or create a User row for a Telegram sender.

    It also syncs the admin flag if the user's Telegram ID appears in ADMIN_IDS.
    """
    uid = str(tg_user_id)
    u = session.query(User).filter_by(telegram_user_id=uid).first()
    if not u:
        u = User(
            telegram_user_id=uid,
            username="",
            first_seen_at=now_wib(),
            is_admin=(uid in ADMIN_USER_IDS),
        )
        session.add(u)
        session.commit()
    return u
