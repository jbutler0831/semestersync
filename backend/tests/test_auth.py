from sqlalchemy import text
from app import email as mail
from app.db import engine
from conftest import PASSWORD, auth, last_code, signup


def q(sql, **kw):
    with engine().begin() as c:
        r = c.execute(text(sql), kw)
        return r.all() if r.returns_rows else None


def test_register_signs_in_at_once_sends_nothing_and_stores_only_an_argon2id_hash(client):
    r = client.post("/v1/auth/register", json={"email": "  Ana@Example.EDU ", "password": PASSWORD, "device": "Test Mac"})
    assert r.status_code == 201 and r.json()["user"]["email"] == "ana@example.edu" and r.json()["token"]
    assert client.get("/v1/account", headers=auth(r.json()["token"])).status_code == 200
    assert mail.outbox == []
    (email, h), = q("select email, password_hash from users")
    assert email == "ana@example.edu" and h.startswith("$argon2id$") and PASSWORD not in h


def test_an_email_can_only_have_one_account(client):
    signup(client)
    r = client.post("/v1/auth/register", json={"email": "ANA@example.edu", "password": "another password"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken" and "Sign in" in r.json()["error"]["message"]
    # The existing account's password didn't change.
    assert client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "another password"}).status_code == 401
    assert client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": PASSWORD}).status_code == 200


def test_the_old_confirmation_endpoints_are_gone(client):
    assert client.post("/v1/auth/verify", json={"email": "ana@example.edu", "code": "123456"}).status_code == 404
    assert client.post("/v1/auth/resend", json={"email": "ana@example.edu"}).status_code == 404


def test_sign_up_is_rate_limited_per_address(client):
    codes = [client.post("/v1/auth/register", json={"email": f"s{i}@example.edu", "password": PASSWORD}).status_code for i in range(21)]
    assert codes[:20] == [201] * 20 and codes[20] == 429


def test_wrong_reset_codes_are_limited(client):
    signup(client)
    client.post("/v1/auth/password-reset/request", json={"email": "ana@example.edu"})
    code = last_code("ana@example.edu")
    wrong = "000000" if code != "000000" else "111111"
    body = {"email": "ana@example.edu", "new_password": "brand new password"}
    for _ in range(5):
        r = client.post("/v1/auth/password-reset/confirm", json={**body, "code": wrong})
        assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_code"
    # After 5 wrong tries even the right code is dead.
    assert client.post("/v1/auth/password-reset/confirm", json={**body, "code": code}).status_code == 400
    assert q("select attempts from email_codes")[0][0] == 5
    assert code.encode() not in bytes(q("select code_hash from email_codes")[0][0])


def test_expired_reset_code_fails(client):
    signup(client)
    client.post("/v1/auth/password-reset/request", json={"email": "ana@example.edu"})
    code = last_code("ana@example.edu")
    q("update email_codes set expires_at = now() - interval '1 second'")
    r = client.post("/v1/auth/password-reset/confirm", json={"email": "ana@example.edu", "code": code, "new_password": "brand new password"})
    assert r.status_code == 400


def test_a_new_reset_code_replaces_the_old_one(client):
    signup(client)
    client.post("/v1/auth/password-reset/request", json={"email": "ana@example.edu"})
    old = last_code("ana@example.edu")
    client.post("/v1/auth/password-reset/request", json={"email": "ana@example.edu"})
    new = last_code("ana@example.edu")
    body = {"email": "ana@example.edu", "new_password": "brand new password"}
    if old != new:
        assert client.post("/v1/auth/password-reset/confirm", json={**body, "code": old}).status_code == 400
    assert client.post("/v1/auth/password-reset/confirm", json={**body, "code": new}).status_code == 200


def test_reset_for_an_unknown_email_is_silent(client):
    r = client.post("/v1/auth/password-reset/request", json={"email": "nobody@example.edu"})
    assert r.status_code == 202 and r.json() == {"status": "sent"} and mail.outbox == []


def test_reset_lets_the_inbox_owner_take_back_an_account_someone_else_made(client):
    # Without a sign-up code, anyone can sign up with an address they don't own. Its owner can reset the
    # password, which signs the other person out everywhere.
    squatter = signup(client, password="squatter password")
    client.post("/v1/auth/password-reset/request", json={"email": "ana@example.edu"})
    r = client.post("/v1/auth/password-reset/confirm", json={"email": "ana@example.edu", "code": last_code("ana@example.edu"), "new_password": "the real ana"})
    assert r.status_code == 200
    assert client.get("/v1/account", headers=auth(squatter)).status_code == 401
    assert client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "squatter password"}).status_code == 401


def test_login_errors_do_not_reveal_which_part_was_wrong(client):
    signup(client)
    a = client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "wrong password"})
    b = client.post("/v1/auth/login", json={"email": "nobody@example.edu", "password": "wrong password"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


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
    r = client.post("/v1/auth/password-reset/confirm", json={"email": "ana@example.edu", "code": "123456", "new_password": secret})
    assert r.status_code == 422 and secret not in r.text and "8 to 128" in r.json()["error"]["message"]
    r = client.post("/v1/auth/login", json={"email": "not-an-email", "password": "whatever123"})
    assert r.status_code == 422 and "whatever123" not in r.text


def test_large_bodies_are_refused(client):
    r = client.post("/v1/auth/login", content=b"{" + b" " * 20000 + b"}", headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_responses_are_not_cached(client):
    r = client.post("/v1/auth/login", json={"email": "a@example.edu", "password": "whatever123"})
    assert r.headers["cache-control"] == "no-store"
