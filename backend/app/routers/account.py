"""The signed-in person's own account. The user is always the session's owner; ids in URLs only pick
among that person's own rows."""
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import Caller, current
from ..models import AuthSession, User
from ..ratelimit import hit
from ..schemas import ChangePasswordIn, DeleteAccountIn, DeviceOut, Status, UserOut
from ..security import hash_password, verify_password
from .auth import fail, user_out

router = APIRouter(prefix="/v1/account", tags=["account"])


def now() -> datetime:
    return datetime.now(timezone.utc)


def check_password(db: Session, caller: Caller, password: str) -> None:
    hit(db, f"reauth:user:{caller.user.id}", 10, timedelta(minutes=15))
    if not verify_password(caller.user.password_hash, password):
        fail(db, 401, "wrong_password", "That password isn't right.")


@router.get("", response_model=UserOut)
def me(caller: Caller = Depends(current)):
    return user_out(caller.user)


@router.post("/password", response_model=Status)
def change_password(body: ChangePasswordIn, caller: Caller = Depends(current), db: Session = Depends(get_db)):
    check_password(db, caller, body.current_password)
    caller.user.password_hash = hash_password(body.new_password)
    caller.user.password_changed_at = now()
    # Signs out every other device; this one stays signed in.
    db.execute(update(AuthSession).where(AuthSession.user_id == caller.user.id, AuthSession.id != caller.session.id,
                                         AuthSession.revoked_at.is_(None)).values(revoked_at=now()))
    return Status(status="password_changed")


@router.get("/sessions", response_model=list[DeviceOut])
def sessions(caller: Caller = Depends(current), db: Session = Depends(get_db)):
    rows = db.execute(select(AuthSession).where(AuthSession.user_id == caller.user.id, AuthSession.revoked_at.is_(None),
                                                AuthSession.expires_at > now()).order_by(AuthSession.last_seen_at.desc())).scalars()
    return [DeviceOut(id=s.id, device=s.device, created_at=s.created_at, last_seen_at=s.last_seen_at, current=s.id == caller.session.id) for s in rows]


@router.delete("/sessions/{session_id}", response_model=Status)
def revoke_session(session_id: uuid.UUID, caller: Caller = Depends(current), db: Session = Depends(get_db)):
    done = db.execute(update(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == caller.user.id,
                                                AuthSession.revoked_at.is_(None)).values(revoked_at=now()))
    if done.rowcount == 0:  # someone else's session looks exactly like one that doesn't exist
        raise HTTPException(404, detail={"code": "not_found", "message": "That device isn't signed in."})
    return Status(status="signed_out")


@router.post("/sessions/revoke-others", response_model=Status)
def revoke_others(caller: Caller = Depends(current), db: Session = Depends(get_db)):
    db.execute(update(AuthSession).where(AuthSession.user_id == caller.user.id, AuthSession.id != caller.session.id,
                                         AuthSession.revoked_at.is_(None)).values(revoked_at=now()))
    return Status(status="signed_out")


@router.post("/delete", response_model=Status)
def delete_account(body: DeleteAccountIn, caller: Caller = Depends(current), db: Session = Depends(get_db)):
    """Deletes the account immediately. Sessions and codes go with it (ON DELETE CASCADE)."""
    check_password(db, caller, body.password)
    db.execute(delete(User).where(User.id == caller.user.id))
    return Status(status="deleted")
