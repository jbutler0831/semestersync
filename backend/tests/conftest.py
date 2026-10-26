import os
import re
import pytest
from sqlalchemy import text

assert os.environ.get("APP_ENV") == "test", "Run the tests with scripts/test.sh; it starts a throwaway database."

from fastapi.testclient import TestClient  # noqa: E402
from app import email as mail  # noqa: E402
from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def clean():
    with engine().begin() as c:
        c.execute(text("TRUNCATE users, sessions, email_codes, rate_events, sync_docs RESTART IDENTITY CASCADE"))
    mail.outbox.clear()
    yield


@pytest.fixture
def client():
    return TestClient(app)


def last_code(to: str) -> str:
    msgs = [m for m in mail.outbox if m["to"] == to]
    assert msgs, f"no email to {to}"
    return re.search(r"\b(\d{6})\b", msgs[-1]["text"]).group(1)


def signup(client, email="ana@example.edu", password=PASSWORD, device="Test Mac") -> str:
    r = client.post("/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 202, r.text
    r = client.post("/v1/auth/verify", json={"email": email, "code": last_code(email), "device": device})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
