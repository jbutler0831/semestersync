"""Counts attempts in the database so limits hold across restarts and multiple API processes."""
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from .config import settings
from .models import RateEvent


def hit(db: Session, key: str, limit: int, window: timedelta, *, record: bool = True) -> None:
    """Raises 429 if `key` already has `limit` attempts in `window`; otherwise records this one."""
    if not settings().rate_limits:
        return
    now = datetime.now(timezone.utc)
    since = now - window
    count, oldest = db.execute(select(func.count(), func.min(RateEvent.at)).where(RateEvent.key == key, RateEvent.at > since)).one()
    if count >= limit:
        retry = max(1, int((oldest + window - now).total_seconds()) + 1) if oldest else int(window.total_seconds())
        raise HTTPException(429, detail={"code": "rate_limited", "message": f"Too many attempts. Try again in {retry // 60 + 1 if retry > 60 else retry} {'minutes' if retry > 60 else 'seconds'}."}, headers={"Retry-After": str(retry)})
    if record:
        db.add(RateEvent(key=key[:200]))
        db.flush()


def prune(db: Session) -> None:
    db.execute(delete(RateEvent).where(RateEvent.at < datetime.now(timezone.utc) - timedelta(days=2)))
