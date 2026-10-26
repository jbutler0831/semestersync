"""Opt-in sync of the signed-in person's documents. Every query is limited to the session's user.

Changes use compare-and-swap: a write applies only if the document's version on the server still equals the
version the computer last saw (`base_version`), so an edit made without seeing the latest copy is never accepted.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import Caller, current
from ..models import SyncDoc, User
from ..ratelimit import hit, prune
from ..schemas import Status
from .account import check_password
from .auth import fail

router = APIRouter(prefix="/v1/sync", tags=["sync"])
HOUR = timedelta(hours=1)
DOC_ID = re.compile(r"^(course-[A-Za-z0-9_-]{1,40}|extras|deck-[A-Za-z0-9_-]{1,40})$")
MAX_DOC_BYTES = 1_000_000
MAX_DOCS = 300
MAX_BYTES = 25 * 1024 * 1024
MAX_BATCH = 50
PAGE = 100
TOMBSTONE_DAYS = 90


def now() -> datetime:
    return datetime.now(timezone.utc)


class Change(BaseModel):
    doc_id: str = Field(max_length=64)
    base_version: int = Field(ge=0)
    body: str | None = None
    deleted: bool = False

    @model_validator(mode="after")
    def one_of(self):
        if not DOC_ID.match(self.doc_id):
            raise ValueError("doc_id")
        if self.deleted == (self.body is not None):
            raise ValueError("body")
        return self


class PushIn(BaseModel):
    changes: list[Change] = Field(max_length=MAX_BATCH)
    # The epoch the computer last saw. If the person removed their synced data since, nothing is written, so a
    # computer that hasn't heard about it yet can't put any of it back.
    epoch: int | None = Field(None, ge=0)


class ClearIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


def doc_out(d: SyncDoc) -> dict:
    return {"doc_id": d.doc_id, "version": d.version, "seq": d.seq, "deleted": d.deleted, "body": None if d.deleted else d.body,
            "updated_at": d.updated_at.isoformat(), "device": d.device}


def locked_user(db: Session, caller: Caller) -> User:
    # One sync write at a time per person, so version and change numbers never race.
    return db.execute(select(User).where(User.id == caller.user.id).with_for_update()).scalar_one()


@router.get("/changes")
def changes(since: int = Query(0, ge=0), caller: Caller = Depends(current), db: Session = Depends(get_db)):
    hit(db, f"sync-pull:{caller.user.id}", 600, HOUR)
    u = caller.user
    rows = db.execute(select(SyncDoc).where(SyncDoc.user_id == u.id, SyncDoc.seq > since).order_by(SyncDoc.seq).limit(PAGE + 1)).scalars().all()
    more = len(rows) > PAGE
    rows = rows[:PAGE]
    return {"docs": [doc_out(d) for d in rows], "cursor": rows[-1].seq if rows else min(since, u.sync_seq),
            "more": more, "epoch": u.sync_epoch,
            # Deletion markers older than this computer's cursor were purged: it must compare everything.
            "reset": 0 < since < u.sync_purged_seq}


@router.post("/push")
def push(body: PushIn, caller: Caller = Depends(current), db: Session = Depends(get_db)):
    hit(db, f"sync-push:{caller.user.id}", 120, HOUR)
    if len({c.doc_id for c in body.changes}) != len(body.changes):
        fail(db, 422, "invalid_request", "Each document can appear once per push.")
    u = locked_user(db, caller)
    if body.epoch is not None and body.epoch != u.sync_epoch:
        return {"results": [], "epoch": u.sync_epoch}
    ids = [c.doc_id for c in body.changes]
    existing = {d.doc_id: d for d in db.execute(select(SyncDoc).where(SyncDoc.user_id == u.id, SyncDoc.doc_id.in_(ids))).scalars()}
    count, used = db.execute(select(func.count(), func.coalesce(func.sum(SyncDoc.size), 0)).where(SyncDoc.user_id == u.id, SyncDoc.deleted.is_(False))).one()
    results = []
    for c in body.changes:
        d = existing.get(c.doc_id)
        have = d.version if d else 0
        if c.base_version != have:
            results.append({"doc_id": c.doc_id, "status": "conflict", "server": doc_out(d) if d else {"doc_id": c.doc_id, "version": 0, "deleted": True, "body": None}})
            continue
        size = 0
        if not c.deleted:
            size = len(c.body.encode("utf-8"))
            try:
                ok = isinstance(json.loads(c.body), (dict, list))
            except ValueError:
                ok = False
            if not ok:
                results.append({"doc_id": c.doc_id, "status": "rejected", "code": "invalid_body", "message": "That document couldn't be read."})
                continue
            if size > MAX_DOC_BYTES:
                results.append({"doc_id": c.doc_id, "status": "rejected", "code": "too_large", "message": "This course is too large to sync (over 1 MB)."})
                continue
        live = d is not None and not d.deleted
        new_count = count + (0 if c.deleted else 1) - (1 if live else 0)
        new_used = used + size - (d.size if live else 0)
        if not c.deleted and (new_count > MAX_DOCS or new_used > MAX_BYTES):
            results.append({"doc_id": c.doc_id, "status": "rejected", "code": "quota", "message": "Your account is full (25 MB). Remove old study sets or courses from sync."})
            continue
        if c.deleted and d is None:  # deleting something the server never had: nothing to record
            results.append({"doc_id": c.doc_id, "status": "ok", "version": 0, "seq": None})
            continue
        u.sync_seq += 1
        if d is None:
            d = SyncDoc(user_id=u.id, doc_id=c.doc_id, version=0, seq=0)
            db.add(d)
        d.version = have + 1
        d.seq = u.sync_seq
        d.deleted = c.deleted
        d.body = None if c.deleted else c.body
        d.size = size
        d.device = caller.session.device
        d.updated_at = now()
        count, used = new_count, new_used
        results.append({"doc_id": c.doc_id, "status": "ok", "version": d.version, "seq": d.seq})
    db.flush()
    purge(db, u)
    return {"results": results, "epoch": u.sync_epoch}


def purge(db: Session, u: User) -> None:
    """Deletion markers are kept for 90 days. A computer whose cursor is older than a purged one compares everything."""
    old = db.execute(delete(SyncDoc).where(SyncDoc.user_id == u.id, SyncDoc.deleted.is_(True),
                                           SyncDoc.updated_at < now() - timedelta(days=TOMBSTONE_DAYS)).returning(SyncDoc.seq)).scalars().all()
    if old:
        u.sync_purged_seq = max(u.sync_purged_seq, max(old))
    prune(db)


@router.get("/usage")
def usage(caller: Caller = Depends(current), db: Session = Depends(get_db)):
    count, used = db.execute(select(func.count(), func.coalesce(func.sum(SyncDoc.size), 0)).where(SyncDoc.user_id == caller.user.id, SyncDoc.deleted.is_(False))).one()
    return {"docs": count, "bytes": int(used), "max_docs": MAX_DOCS, "max_bytes": MAX_BYTES}


@router.post("/clear", response_model=Status)
def clear(body: ClearIn, caller: Caller = Depends(current), db: Session = Depends(get_db)):
    """Removes all of this person's synced data and keeps the account. Other computers see the new epoch and stop syncing."""
    check_password(db, caller, body.password)
    u = locked_user(db, caller)
    db.execute(delete(SyncDoc).where(SyncDoc.user_id == u.id))
    u.sync_epoch += 1
    u.sync_purged_seq = u.sync_seq
    return Status(status="cleared")
