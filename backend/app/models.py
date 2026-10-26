"""Tables. Every row that belongs to a person points at users.id and is removed with them (ON DELETE CASCADE)."""
import uuid
from datetime import datetime
from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    email: Mapped[str] = mapped_column(String(254), nullable=False)  # stored lower-case
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    password_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Sync bookkeeping: a counter raised on every change to this person's documents, a number that changes
    # when they clear their synced data, and the newest change number of any deletion marker purged since.
    sync_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    sync_epoch: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    sync_purged_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    __table_args__ = (
        Index("users_email_key", text("lower(email)"), unique=True),
        CheckConstraint("email = lower(email) AND length(email) BETWEEN 3 AND 254", name="users_email_lower"),
    )


class AuthSession(Base):
    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False, unique=True)
    device: Mapped[str] = mapped_column(String(80), nullable=False, server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EmailCode(Base):
    __tablename__ = "email_codes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    code_hash: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("purpose IN ('verify', 'reset')", name="email_codes_purpose"),
        Index("email_codes_user_purpose", "user_id", "purpose"),
    )


class RateEvent(Base):
    """One row per attempt, per limit key (e.g. 'login:email:...' or 'login:ip:...'). Old rows are pruned."""
    __tablename__ = "rate_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    __table_args__ = (Index("rate_events_key_at", "key", "at"),)


class SyncDoc(Base):
    """One synced document (a course, the Inbox, settings, or a study set). The body is stored as the app sent it
    and never interpreted. A deleted document keeps its row (body cleared) so other computers learn of it."""
    __tablename__ = "sync_docs"
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    doc_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    body: Mapped[str | None] = mapped_column(Text)
    size: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    device: Mapped[str] = mapped_column(String(80), nullable=False, server_default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    __table_args__ = (Index("sync_docs_user_seq", "user_id", "seq"),)
