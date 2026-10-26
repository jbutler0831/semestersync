"""Study rooms: who's studying, their timer and a chat, live over a WebSocket. Nothing is stored.

Rooms don't need an account (they never did), so anyone with a room code can join. Everything a person sends is
cleaned and kept short before it reaches anyone else, and chat names come from the sender's own presence, so no
one can post as someone else. Names, tasks and messages are never logged.

Rooms live in this process's memory, so the API must run as a single process (as the Dockerfile does).
"""
import asyncio
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import timedelta
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from ..config import settings
from ..db import get_db
from ..ratelimit import hit

router = APIRouter(prefix="/v1/rooms", tags=["rooms"])
log = logging.getLogger("semestersync")

CODE = re.compile(r"^[A-Z0-9]{4,8}$")
MAX_PEERS = 50           # people in one room
MAX_ROOMS = 2000         # rooms open at once on this server
MAX_PER_IP = 5           # open connections from one address
JOINS_PER_HOUR = 60      # new connections from one address
MAX_MESSAGE = 2048       # bytes in one message from the app
BURST, BURST_SECONDS = 20, 10  # messages from one connection
SEND_TIMEOUT = 5

# Close codes the app turns into messages.
BAD_CODE, FULL, BUSY, LIMITED, TOO_FAST, BAD_MESSAGE = 4400, 4001, 4002, 4029, 4008, 4003
CTRL = re.compile(r"[\u0000-\u001f\u007f]")


def clip(v, n: int) -> str:
    return CTRL.sub("", v if isinstance(v, str) else "")[:n]


def clean_presence(p: dict) -> dict:
    t = p.get("timer")
    timer = None
    if isinstance(t, dict) and t.get("mode") in ("focus", "break") and isinstance(t.get("ends"), (int, float)) and not isinstance(t.get("ends"), bool):
        timer = {"mode": t["mode"], "ends": int(t["ends"])}
    return {"name": clip(p.get("name"), 200).strip()[:32], "task": clip(p.get("task"), 120), "timer": timer}


@dataclass(eq=False)
class Peer:
    ws: WebSocket
    id: str
    ip: str
    presence: dict = field(default_factory=lambda: {"name": "", "task": "", "timer": None})
    sent: list = field(default_factory=list)


rooms: dict[str, set[Peer]] = {}
per_ip: dict[str, int] = {}


async def send(peer: Peer, msg: dict) -> None:
    try:
        await asyncio.wait_for(peer.ws.send_json(msg), SEND_TIMEOUT)
    except Exception:
        pass  # a slow or gone connection is dropped by its own loop


async def broadcast_peers(code: str) -> None:
    peers = list(rooms.get(code, ()))
    listing = [{"id": p.id, **p.presence} for p in peers]
    await asyncio.gather(*(send(p, {"t": "peers", "you": p.id, "peers": listing}) for p in peers))


def client_ip(ws: WebSocket) -> str:
    if settings().trust_proxy:
        fwd = ws.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()[:64]
    return (ws.client.host if ws.client else "unknown")[:64]


def allowed_join(ip: str) -> bool:
    gen = get_db()
    db = next(gen)
    try:
        hit(db, f"room:ip:{ip}", JOINS_PER_HOUR, timedelta(hours=1))
    except HTTPException:
        gen.close()
        return False
    try:
        next(gen)  # commits
    except StopIteration:
        pass
    return True


async def refuse(ws: WebSocket, code: int, message: str) -> None:
    await ws.send_json({"t": "error", "message": message})
    await ws.close(code)


@router.websocket("/{code}")
async def room(ws: WebSocket, code: str):
    await ws.accept()
    if not CODE.match(code):
        return await refuse(ws, BAD_CODE, "Room codes are 4 to 8 letters or numbers.")
    ip = client_ip(ws)
    if per_ip.get(ip, 0) >= MAX_PER_IP:
        return await refuse(ws, BUSY, "Too many study rooms open from this network. Leave one and try again.")
    if not await asyncio.to_thread(allowed_join, ip):
        return await refuse(ws, LIMITED, "Too many study rooms joined from this network. Try again later.")
    members = rooms.get(code)
    if members is None and len(rooms) >= MAX_ROOMS:
        return await refuse(ws, BUSY, "Study rooms are busy right now. Try again in a few minutes.")
    if members is not None and len(members) >= MAX_PEERS:
        return await refuse(ws, FULL, f"This room is full ({MAX_PEERS} people). Start a new one.")

    me = Peer(ws=ws, id=secrets.token_urlsafe(9), ip=ip)
    rooms.setdefault(code, set()).add(me)
    per_ip[ip] = per_ip.get(ip, 0) + 1
    try:
        await send(me, {"t": "hello", "you": me.id})
        await broadcast_peers(code)
        while True:
            raw = await ws.receive_text()
            now = time.monotonic()
            me.sent = [s for s in me.sent if s > now - BURST_SECONDS] + [now]
            if len(me.sent) > BURST:
                return await refuse(ws, TOO_FAST, "You're sending too fast. Rejoin the room in a moment.")
            if len(raw.encode()) > MAX_MESSAGE:
                return await refuse(ws, BAD_MESSAGE, "That message was too long.")
            try:
                msg = json.loads(raw)
            except ValueError:
                return await refuse(ws, BAD_MESSAGE, "The app sent something the room didn't understand.")
            if not isinstance(msg, dict):
                continue
            if msg.get("t") == "presence":
                me.presence = clean_presence(msg)
                await broadcast_peers(code)
            elif msg.get("t") == "chat":
                text = clip(msg.get("text"), 500).strip()
                if text:
                    out = {"t": "chat", "id": me.id, "name": me.presence["name"], "text": text}
                    await asyncio.gather(*(send(p, out) for p in list(rooms.get(code, ())) if p is not me))
    except WebSocketDisconnect:
        pass
    finally:
        members = rooms.get(code)
        if members is not None:
            members.discard(me)
            if not members:
                rooms.pop(code, None)
        per_ip[ip] = per_ip.get(ip, 1) - 1
        if per_ip[ip] <= 0:
            per_ip.pop(ip, None)
        if code in rooms:
            await broadcast_peers(code)
