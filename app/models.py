"""models for DBs"""

from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .db import Base
from .timezone import now_wib


class User(Base):
    """Users"""

    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    telegram_user_id = Column(String, unique=True, index=True)
    username = Column(String)
    first_seen_at = Column(DateTime, default=now_wib)
    is_admin = Column(Boolean, default=False)

    bots = relationship("Bot", back_populates="owner", cascade="all,delete")
    destinations = relationship(
        "Destination", back_populates="owner", cascade="all,delete"
    )
    subs = relationship("Subscription", back_populates="owner", cascade="all,delete")
    sessions = relationship(
        "AdminSession", back_populates="user", cascade="all,delete"
    )


class Bot(Base):
    """Bots"""

    __tablename__ = "bots"
    id = Column(Integer, primary_key=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), index=True)
    bot_id = Column(String, index=True)
    token = Column(String)
    created_at = Column(DateTime, default=now_wib)

    owner = relationship("User", back_populates="bots")
    subs = relationship("Subscription", back_populates="bot")


class Destination(Base):
    """Destination"""

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
    """Subs"""

    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), index=True)
    hook_id = Column(String, unique=True, index=True)
    secret = Column(String)
    repo = Column(String)
    events_csv = Column(String, default="*")
    bot_id = Column(Integer, ForeignKey("bots.id"), index=True)
    destination_id = Column(Integer, ForeignKey("destinations.id"), index=True)
    created_at = Column(DateTime, default=now_wib)

    owner = relationship("User", back_populates="subs")
    bot = relationship("Bot", back_populates="subs")
    destination = relationship("Destination", back_populates="subs")
    logs = relationship("WebhookEventLog", back_populates="subscription", cascade="all,delete")


class AdminSession(Base):
    """Web admin sessions."""

    __tablename__ = "admin_sessions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token = Column(String, unique=True, index=True)
    created_at = Column(DateTime, default=now_wib)
    expires_at = Column(DateTime, nullable=False)

    user = relationship("User", back_populates="sessions")


class WebhookEventLog(Base):
    """Stored GitHub webhook deliveries."""

    __tablename__ = "webhook_event_logs"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=now_wib, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=True, index=True)
    hook_id = Column(String, index=True)
    event_type = Column(String, index=True)
    repository = Column(String, default="")
    status = Column(String, default="success", index=True)
    summary = Column(Text, default="")
    payload = Column(Text, default="")
    error_message = Column(Text, nullable=True)

    subscription = relationship("Subscription", back_populates="logs")
