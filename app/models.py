"""models for DBs"""

from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
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
