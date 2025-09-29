"""the beautiful world start from here."""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(settings.db_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    """
    Create a new SQLAlchemy session.
    Caller is responsible for committing/closing when appropriate.
    """
    # FastAPI dependency-style session factory
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
