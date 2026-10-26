"""Database engine and sessions. All queries go through SQLAlchemy, so values are always sent as parameters."""
from collections.abc import Iterator
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from .config import settings

_engine = None
_Session = None


def engine():
    global _engine, _Session
    if _engine is None:
        _engine = create_engine(settings().database_url, pool_pre_ping=True, future=True)
        _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def get_db() -> Iterator[Session]:
    engine()
    db = _Session()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
