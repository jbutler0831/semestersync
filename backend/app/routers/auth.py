"""Account creation, email verification, sign-in, sign-out and password reset.

Responses never reveal whether an email has an account, except sign-in with the correct password
for an account whose email isn't verified yet (the person has proved they know the password)."""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from .. import email as mail
from ..config import settings
from ..db import get_db
from ..deps import Caller, client_ip, current
from ..models import AuthSession, EmailCode, User
from ..ratelimit import hit, prune
from ..schemas import EmailIn, LoginIn, RegisterIn, ResetConfirmIn, SessionOut, Status, UserOut, VerifyIn
from ..security import code_hash, hash_password, needs_rehash, new_code, new_session_token, same, verify_password

router = APIRouter(prefix="/v1/auth", tags=["auth"])
MIN, HOUR, DAY = timedelta(minutes=1), timedelta(hours=1), timedelta(days=1)
SENT = Status(status="sent")


def now() -> datetime:
    return datetime.now(timezone.utc)


def fail(db: Session, status: int, code: str, message: str):
    """Keeps counters (rate events, code attempts) written before an error, then raises it."""
    db.commit()
    raise HTTPException(status, detail={"code": code, "message": message})


def find_user(db: Session, email: str) -> User | None:
    return db.execute(select(User).where(User.email == email)).scalar_one_or_none()


def user_out(u: User) -> UserOut:
    return UserOut(id=u.id, email=u.email, email_verified=u.email_verified_at is not None, created_at=u.created_at)


def start_session(db: Session, user: User, device: str) -> SessionOut:
    token, token_hash = new_session_token()
    expires = now() + timedelta(days=settings().session_days)
    db.add(AuthSession(user_id=user.id, token_hash=token_hash, device=device.strip()[:80], expires_at=expires))
    db.flush()
    return SessionOut(token=token, expires_at=expires, user=user_out(user))


def send_code(db: Session, user: User, purpose: str) -> None:
    """Replaces any earlier unused code of the same purpose, so only the newest email works."""
    db.execute(update(EmailCode).where(EmailCode.user_id == user.id, EmailCode.purpose == purpose, EmailCode.used_at.is_(None)).values(used_at=now()))
    code = new_code()
    minutes = settings().code_minutes
    db.add(EmailCode(user_id=user.id, purpose=purpose, code_hash=code_hash(user.id, purpose, code), expires_at=now() + timedelta(minutes=minutes)))
    db.flush()
    mail.send_code(user.email, purpose, code, minutes)


def check_code(db: Session, user: User | None, purpose: str, code: str) -> EmailCode:
    bad = "That code isn't right or has expired. Check the newest email, or ask for a new code."
    if not user:
        fail(db, 400, "invalid_code", bad)
    row = db.execute(select(EmailCode).where(EmailCode.user_id == user.id, EmailCode.purpose == purpose, EmailCode.used_at.is_(None))
                     .order_by(EmailCode.created_at.desc()).limit(1).with_for_update()).scalar_one_or_none()
    if not row or row.expires_at <= now() or row.attempts >= settings().code_max_attempts:
        fail(db, 400, "invalid_code", bad)
    if not same(row.code_hash, code_hash(user.id, purpose, code.strip())):
        row.attempts += 1
        if row.attempts >= settings().code_max_attempts:
            row.used_at = now()
            fail(db, 400, "invalid_code", "Too many wrong codes. Ask for a new code.")
        fail(db, 400, "invalid_code", bad)
    row.used_at = now()
    return row


def limit_email_sends(db: Session, request: Request, email: str, kind: str) -> None:
    ip = client_ip(request)
    hit(db, f"{kind}:ip:{ip}", 20, HOUR)
    hit(db, f"mail:{email}", 5, HOUR)


@router.post("/register", response_model=Status, status_code=202)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    limit_email_sends(db, request, body.email, "register")
    user = find_user(db, body.email)
    if user and user.email_verified_at:
        mail.send_already_registered(user.email)
        return SENT
    if user:  # never verified: whoever can read the inbox decides the password
        user.password_hash = hash_password(body.password)
        user.password_changed_at = now()
    else:
        user = User(email=body.email, password_hash=hash_password(body.password))
        db.add(user)
        db.flush()
    send_code(db, user, "verify")
    return SENT


@router.post("/verify", response_model=SessionOut)
def verify(body: VerifyIn, request: Request, db: Session = Depends(get_db)):
    hit(db, f"code:ip:{client_ip(request)}", 30, HOUR)
    user = find_user(db, body.email)
    check_code(db, user, "verify", body.code)
    user.email_verified_at = user.email_verified_at or now()
    prune(db)
    return start_session(db, user, body.device)


@router.post("/resend", response_model=Status, status_code=202)
def resend(body: EmailIn, request: Request, db: Session = Depends(get_db)):
    limit_email_sends(db, request, body.email, "resend")
    user = find_user(db, body.email)
    if user and not user.email_verified_at:
        send_code(db, user, "verify")
    return SENT


@router.post("/login", response_model=SessionOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    hit(db, f"login:ip:{ip}", 30, 15 * MIN)
    hit(db, f"login:email:{body.email}", 10, 15 * MIN)
    user = find_user(db, body.email)
    if not verify_password(user.password_hash if user else None, body.password):
        fail(db, 401, "invalid_credentials", "That email and password don't match.")
    if not user.email_verified_at:
        fail(db, 403, "email_not_verified", "Confirm your email first. Enter the code we sent, or ask for a new one.")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    return start_session(db, user, body.device)


@router.post("/logout", response_model=Status)
def logout(caller: Caller = Depends(current)):
    caller.session.revoked_at = now()
    return Status(status="signed_out")


@router.post("/password-reset/request", response_model=Status, status_code=202)
def reset_request(body: EmailIn, request: Request, db: Session = Depends(get_db)):
    limit_email_sends(db, request, body.email, "reset")
    user = find_user(db, body.email)
    if user:
        send_code(db, user, "reset")
    return SENT


@router.post("/password-reset/confirm", response_model=Status)
def reset_confirm(body: ResetConfirmIn, request: Request, db: Session = Depends(get_db)):
    hit(db, f"code:ip:{client_ip(request)}", 30, HOUR)
    user = find_user(db, body.email)
    check_code(db, user, "reset", body.code)
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = now()
    user.email_verified_at = user.email_verified_at or now()  # the code proves they read the inbox
    db.execute(update(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)).values(revoked_at=now()))
    return Status(status="password_changed")
