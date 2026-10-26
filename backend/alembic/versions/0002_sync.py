"""Sync: synced documents and per-person sync counters.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("sync_seq", sa.BigInteger, nullable=False, server_default="0"))
    op.add_column("users", sa.Column("sync_epoch", sa.Integer, nullable=False, server_default="1"))
    op.add_column("users", sa.Column("sync_purged_seq", sa.BigInteger, nullable=False, server_default="0"))
    op.create_table(
        "sync_docs",
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("doc_id", sa.String(64), primary_key=True),
        sa.Column("body", sa.Text),
        sa.Column("size", sa.Integer, nullable=False, server_default="0"),
        sa.Column("version", sa.BigInteger, nullable=False),
        sa.Column("seq", sa.BigInteger, nullable=False),
        sa.Column("deleted", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("device", sa.String(80), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("sync_docs_user_seq", "sync_docs", ["user_id", "seq"])


def downgrade() -> None:
    op.drop_table("sync_docs")
    op.drop_column("users", "sync_purged_seq")
    op.drop_column("users", "sync_epoch")
    op.drop_column("users", "sync_seq")
