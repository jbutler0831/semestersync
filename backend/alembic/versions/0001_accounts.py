"""Accounts: users, sessions, email codes and rate-limit events.

Revision ID: 0001
Revises:
Create Date: 2026-10-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

uuid_pk = lambda: sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))
ts = lambda name, **kw: sa.Column(name, sa.DateTime(timezone=True), **kw)
now = sa.func.now()


def upgrade() -> None:
    op.create_table(
        "users", uuid_pk(),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        ts("email_verified_at"),
        ts("created_at", nullable=False, server_default=now),
        ts("password_changed_at", nullable=False, server_default=now),
        sa.CheckConstraint("email = lower(email) AND length(email) BETWEEN 3 AND 254", name="users_email_lower"),
    )
    op.create_index("users_email_key", "users", [sa.text("lower(email)")], unique=True)

    op.create_table(
        "sessions", uuid_pk(),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(32), nullable=False, unique=True),
        sa.Column("device", sa.String(80), nullable=False, server_default=""),
        ts("created_at", nullable=False, server_default=now),
        ts("last_seen_at", nullable=False, server_default=now),
        ts("expires_at", nullable=False),
        ts("revoked_at"),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    op.create_table(
        "email_codes", uuid_pk(),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("code_hash", sa.LargeBinary(32), nullable=False),
        ts("created_at", nullable=False, server_default=now),
        ts("expires_at", nullable=False),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        ts("used_at"),
        sa.CheckConstraint("purpose IN ('verify', 'reset')", name="email_codes_purpose"),
    )
    op.create_index("email_codes_user_purpose", "email_codes", ["user_id", "purpose"])

    op.create_table(
        "rate_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(200), nullable=False),
        ts("at", nullable=False, server_default=now),
    )
    op.create_index("rate_events_key_at", "rate_events", ["key", "at"])


def downgrade() -> None:
    op.drop_table("rate_events")
    op.drop_table("email_codes")
    op.drop_table("sessions")
    op.drop_table("users")
