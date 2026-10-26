"""Who is calling: decided only from the session token, never from anything else the client sends."""
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .models import AuthSession, User
from .security import session_token_hash


@dataclass
class Caller:
    user: User
    session: AuthSession


def client_ip(request: Request) -> str:
    from .config import settings
    if settings().trust_proxy:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def unauthorized(message: str = "Sign in again.") -> HTTPException:
    return HTTPException(401, detail={"code": "unauthorized", "message": message}, headers={"WWW-Authenticate": "Bearer"})


def current(request: Request, db: Session = Depends(get_db)) -> Caller:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise unauthorized()
    token = auth[7:].strip()
    if not token or len(token) > 100:
        raise unauthorized()
    s = db.execute(select(AuthSession).where(AuthSession.token_hash == session_token_hash(token))).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if not s or s.revoked_at is not None or s.expires_at <= now:
        raise unauthorized("Your session has ended. Sign in again.")
    user = db.get(User, s.user_id)
    if not user:
        raise unauthorized()
    if now - s.last_seen_at > timedelta(minutes=10):
        s.last_seen_at = now
    return Caller(user=user, session=s)
