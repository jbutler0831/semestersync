from sqlalchemy import text
from app import email as mail
from app.db import engine
from conftest import PASSWORD, auth, last_code, signup


def q(sql, **kw):
    with engine().begin() as c:
        r = c.execute(text(sql), kw)
        return r.all() if r.returns_rows else None


def test_register_sends_a_code_and_stores_only_an_argon2id_hash(client):
    r = client.post("/v1/auth/register", json={"email": "  Ana@Example.EDU ", "password": PASSWORD})
    assert r.status_code == 202 and r.json() == {"status": "sent"}
    assert mail.outbox[-1]["to"] == "ana@example.edu"
    (email, h, verified), = q("select email, password_hash, email_verified_at from users")
    assert email == "ana@example.edu" and verified is None
    assert h.startswith("$argon2id$") and PASSWORD not in h
    code = last_code("ana@example.edu")
    stored = q("select code_hash from email_codes")[0][0]
    assert code.encode() not in bytes(stored)


def test_register_does_not_reveal_existing_accounts(client):
    signup(client)
    a = client.post("/v1/auth/register", json={"email": "ana@example.edu", "password": "another password"})
    b = client.post("/v1/auth/register", json={"email": "new@example.edu", "password": "another password"})
    assert a.status_code == b.status_code == 202 and a.json() == b.json()
    assert "already have" in mail.outbox[-2]["subject"]
    # The existing account's password didn't change.
    assert client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "another password"}).status_code == 401
    assert client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": PASSWORD}).status_code == 200


def test_verify_gives_a_session(client):
    token = signup(client)
    r = client.get("/v1/account", headers=auth(token))
    assert r.status_code == 200 and r.json()["email"] == "ana@example.edu" and r.json()["email_verified"]


def test_wrong_codes_are_limited(client):
    client.post("/v1/auth/register", json={"email": "ana@example.edu", "password": PASSWORD})
    code = last_code("ana@example.edu")
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        r = client.post("/v1/auth/verify", json={"email": "ana@example.edu", "code": wrong})
        assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_code"
    # After 5 wrong tries even the right code is dead.
    assert client.post("/v1/auth/verify", json={"email": "ana@example.edu", "code": code}).status_code == 400
    assert q("select attempts from email_codes")[0][0] == 5


def test_expired_code_fails(client):
    client.post("/v1/auth/register", json={"email": "ana@example.edu", "password": PASSWORD})
    code = last_code("ana@example.edu")
    q("update email_codes set expires_at = now() - interval '1 second'")
    assert client.post("/v1/auth/verify", json={"email": "ana@example.edu", "code": code}).status_code == 400


def test_new_code_replaces_old_and_codes_are_single_use(client):
    client.post("/v1/auth/register", json={"email": "ana@example.edu", "password": PASSWORD})
    old = last_code("ana@example.edu")
    assert client.post("/v1/auth/resend", json={"email": "ana@example.edu"}).status_code == 202
    new = last_code("ana@example.edu")
    if old != new:
        assert client.post("/v1/auth/verify", json={"email": "ana@example.edu", "code": old}).status_code == 400
    assert client.post("/v1/auth/verify", json={"email": "ana@example.edu", "code": new}).status_code == 200
    assert client.post("/v1/auth/verify", json={"email": "ana@example.edu", "code": new}).status_code == 400


def test_reset_code_cannot_verify_and_unknown_email_is_silent(client):
    client.post("/v1/auth/register", json={"email": "ana@example.edu", "password": PASSWORD})
    client.post("/v1/auth/password-reset/request", json={"email": "ana@example.edu"})
    reset = last_code("ana@example.edu")
    assert "Reset" in mail.outbox[-1]["subject"]
    # Reset requests made the newest mail a reset code; it must not confirm the email via /verify.
    q("update email_codes set used_at = now() where purpose = 'verify'")
    assert client.post("/v1/auth/verify", json={"email": "ana@example.edu", "code": reset}).status_code == 400
    n = len(mail.outbox)
    r = client.post("/v1/auth/password-reset/request", json={"email": "nobody@example.edu"})
    assert r.status_code == 202 and r.json() == {"status": "sent"} and len(mail.outbox) == n


def test_login_errors_do_not_reveal_which_part_was_wrong(client):
    signup(client)
    a = client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "wrong password"})
    b = client.post("/v1/auth/login", json={"email": "nobody@example.edu", "password": "wrong password"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


def test_unverified_login(client):
    client.post("/v1/auth/register", json={"email": "ana@example.edu", "password": PASSWORD})
    assert client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "wrong password"}).status_code == 401
    r = client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": PASSWORD})
    assert r.status_code == 403 and r.json()["error"]["code"] == "email_not_verified"


def test_sessions_are_stored_hashed_and_logout_ends_them(client):
    token = signup(client)
    rows = q("select token_hash::text, device from sessions")
    assert len(rows) == 1 and token not in rows[0][0] and rows[0][1] == "Test Mac"
    assert client.post("/v1/auth/logout", headers=auth(token)).status_code == 200
    assert client.get("/v1/account", headers=auth(token)).status_code == 401


def test_expired_and_bad_tokens(client):
    token = signup(client)
    for h in [{}, {"Authorization": "Bearer "}, {"Authorization": "Basic abc"}, auth("x" * 43), auth("y" * 500)]:
        assert client.get("/v1/account", headers=h).status_code == 401
    q("update sessions set expires_at = now() - interval '1 second'")
    assert client.get("/v1/account", headers=auth(token)).status_code == 401


def test_password_reset_signs_out_everywhere(client):
    t1 = signup(client)
    t2 = client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": PASSWORD}).json()["token"]
    client.post("/v1/auth/password-reset/request", json={"email": "ana@example.edu"})
    code = last_code("ana@example.edu")
    r = client.post("/v1/auth/password-reset/confirm", json={"email": "ana@example.edu", "code": code, "new_password": "brand new password"})
    assert r.status_code == 200
    for t in (t1, t2):
        assert client.get("/v1/account", headers=auth(t)).status_code == 401
    assert client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": PASSWORD}).status_code == 401
    assert client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "brand new password"}).status_code == 200
    # The code can't be reused.
    assert client.post("/v1/auth/password-reset/confirm", json={"email": "ana@example.edu", "code": code, "new_password": "third password!"}).status_code == 400


def test_login_rate_limit(client):
    signup(client)
    codes = [client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "nope nope"}).status_code for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429
    r = client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": PASSWORD})
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


def test_email_send_rate_limit(client):
    codes = [client.post("/v1/auth/password-reset/request", json={"email": "x@example.edu"}).status_code for _ in range(6)]
    assert codes[:5] == [202] * 5 and codes[5] == 429


def test_validation_errors_do_not_echo_input(client):
    secret = "short"
    r = client.post("/v1/auth/register", json={"email": "ana@example.edu", "password": secret})
    assert r.status_code == 422 and secret not in r.text and "8 to 128" in r.json()["error"]["message"]
    r = client.post("/v1/auth/login", json={"email": "not-an-email", "password": "whatever123"})
    assert r.status_code == 422 and "whatever123" not in r.text


def test_large_bodies_are_refused(client):
    r = client.post("/v1/auth/login", content=b"{" + b" " * 20000 + b"}", headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_responses_are_not_cached(client):
    r = client.post("/v1/auth/login", json={"email": "a@example.edu", "password": "whatever123"})
    assert r.headers["cache-control"] == "no-store"
