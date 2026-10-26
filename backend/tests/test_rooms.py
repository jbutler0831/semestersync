import json
import logging
import socket
import threading
import time
import pytest
import uvicorn
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect
from app.main import app
from app.routers import rooms


# A real server on this computer: rooms rely on every connection sharing one event loop, as in production.
@pytest.fixture(scope="session")
def base():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    while not server.started:
        time.sleep(0.02)
    yield f"ws://127.0.0.1:{port}/v1/rooms/"
    server.should_exit = True
    t.join(5)


@pytest.fixture
def client(base):
    return base


class Closed(Exception):
    def __init__(self, code):
        self.code = code


class WS:
    def __init__(self, url):
        self.c = connect(url, open_timeout=5)

    def receive_json(self):
        try:
            return json.loads(self.c.recv(timeout=5))
        except ConnectionClosed as e:
            raise Closed(e.rcvd.code if e.rcvd else None)

    def send_json(self, msg):
        self.c.send(json.dumps(msg))

    def send_text(self, text):
        self.c.send(text)

    def close(self):
        self.c.close()


def join(base, code="ABCD"):
    ws = WS(base + code)
    hello = ws.receive_json()
    assert hello["t"] == "hello"
    return ws, hello["you"]


def peers(ws):
    while True:
        m = ws.receive_json()
        if m["t"] == "peers":
            return m


def settle(check):
    """The server tidies up after a disconnect on its own time."""
    for _ in range(100):
        if check():
            return True
        time.sleep(0.02)
    return False


def refused(base, code="ABCD"):
    ws = WS(base + code)
    err = ws.receive_json()
    assert err["t"] == "error"
    with pytest.raises(Closed) as e:
        ws.receive_json()
    return err["message"], e.value.code


def test_people_in_a_room_see_each_other(client):
    a, a_id = join(client)
    assert [p["id"] for p in peers(a)["peers"]] == [a_id]
    b, b_id = join(client)
    seen_b = peers(b)
    assert seen_b["you"] == b_id and {p["id"] for p in seen_b["peers"]} == {a_id, b_id}
    assert {p["id"] for p in peers(a)["peers"]} == {a_id, b_id}
    b.close()
    assert [p["id"] for p in peers(a)["peers"]] == [a_id]
    a.close()
    assert settle(lambda: rooms.rooms == {} and rooms.per_ip == {})


def test_rooms_are_separate(client):
    a, _ = join(client, "ROOM1")
    peers(a)
    b, b_id = join(client, "ROOM2")
    assert [p["id"] for p in peers(b)["peers"]] == [b_id]
    b.send_json({"t": "chat", "text": "only room 2"})
    a.send_json({"t": "presence", "name": "Ana"})
    assert peers(a)["peers"][0]["name"] == "Ana"  # nothing from room 2 arrived first
    a.close(); b.close()


def test_presence_is_cleaned(client):
    a, _ = join(client)
    peers(a)
    a.send_json({"t": "presence", "name": "  Ana\u0000\u001b" + "x" * 50, "task": "BIO\n150 · " + "y" * 300, "timer": {"mode": "focus", "ends": 123, "extra": "<script>"}, "admin": True})
    p = peers(a)["peers"][0]
    assert p["name"] == "Ana" + "x" * 29 and len(p["name"]) == 32
    assert p["task"].startswith("BIO150") and len(p["task"]) == 120
    assert p["timer"] == {"mode": "focus", "ends": 123}
    assert set(p) == {"id", "name", "task", "timer"}
    a.send_json({"t": "presence", "name": 5, "timer": {"mode": "nap", "ends": 1}})
    p = peers(a)["peers"][0]
    assert p["name"] == "" and p["timer"] is None
    a.send_json({"t": "presence", "timer": {"mode": "focus", "ends": "soon"}})
    assert peers(a)["peers"][0]["timer"] is None
    a.close()


def test_chat_reaches_others_with_the_senders_own_name(client):
    a, a_id = join(client)
    peers(a)
    b, _ = join(client)
    peers(b); peers(a)
    a.send_json({"t": "presence", "name": "Ana"})
    peers(a); peers(b)
    a.send_json({"t": "chat", "text": "  hi\u0007 there  ", "name": "Teacher", "id": "someone-else"})
    m = b.receive_json()
    assert m == {"t": "chat", "id": a_id, "name": "Ana", "text": "hi there"}
    a.send_json({"t": "chat", "text": "z" * 900})
    assert len(b.receive_json()["text"]) == 500
    # Nothing echoes back to the sender: the next thing A hears is B's presence.
    b.send_json({"t": "presence", "name": "Ben"})
    assert peers(a)["peers"]
    a.close(); b.close()


def test_bad_codes_are_refused(client):
    for code in ("abcd", "AB", "ABCDEFGHI", "AB-CD"):
        msg, close = refused(client, code)
        assert close == rooms.BAD_CODE and "4 to 8" in msg
    assert rooms.rooms == {}


def test_a_full_room_is_refused(client, monkeypatch):
    monkeypatch.setattr(rooms, "MAX_PEERS", 2)
    a, _ = join(client); b, _ = join(client)
    msg, close = refused(client)
    assert close == rooms.FULL and "full" in msg
    a.close(); b.close()


def test_connections_per_address_are_limited(client, monkeypatch):
    monkeypatch.setattr(rooms, "MAX_PER_IP", 2)
    a, _ = join(client, "AAAA"); b, _ = join(client, "BBBB")
    msg, close = refused(client, "CCCC")
    assert close == rooms.BUSY
    a.close()
    assert settle(lambda: sum(rooms.per_ip.values()) == 1)
    c, _ = join(client, "CCCC")
    b.close(); c.close()


def test_joins_per_address_are_rate_limited(client, monkeypatch):
    monkeypatch.setattr(rooms, "JOINS_PER_HOUR", 2)
    for _ in range(2):
        ws, _ = join(client)
        ws.close()
    msg, close = refused(client)
    assert close == rooms.LIMITED and "Try again later" in msg


def test_sending_too_fast_or_too_much_closes_the_connection(client, monkeypatch):
    monkeypatch.setattr(rooms, "BURST", 3)
    a, _ = join(client)
    peers(a)
    for _ in range(4):
        a.send_json({"t": "chat", "text": "spam"})
    while (m := a.receive_json())["t"] != "error":
        pass
    with pytest.raises(Closed) as e:
        a.receive_json()
    assert e.value.code == rooms.TOO_FAST
    b, _ = join(client)
    peers(b)
    b.send_text("x" * 3000)
    assert b.receive_json()["t"] == "error"
    with pytest.raises(Closed) as e:
        b.receive_json()
    assert e.value.code == rooms.BAD_MESSAGE
    assert settle(lambda: rooms.rooms == {})


def test_names_and_messages_are_not_logged(client, caplog):
    caplog.set_level(logging.INFO)
    a, _ = join(client)
    peers(a)
    a.send_json({"t": "presence", "name": "SecretName", "task": "SecretTask"})
    peers(a)
    a.send_json({"t": "chat", "text": "SecretChat"})
    a.close()
    server_logs = "\n".join(r.getMessage() for r in caplog.records if not r.name.startswith("websockets.client"))
    for word in ("SecretName", "SecretTask", "SecretChat"):
        assert word not in server_logs
