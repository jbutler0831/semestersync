import logging
from sqlalchemy import text
from app.db import engine
from conftest import PASSWORD, auth, last_code, signup


def q(sql):
    with engine().begin() as c:
        return c.execute(text(sql)).all()


def test_people_only_see_and_change_their_own_account(client):
    ana = signup(client, "ana@example.edu")
    ben = signup(client, "ben@example.edu")
    ben_id = client.get("/v1/account", headers=auth(ben)).json()["id"]
    # A user id supplied by the client is ignored: the session decides who you are.
    r = client.get(f"/v1/account?user_id={ben_id}", headers={**auth(ana), "X-User-Id": ben_id})
    assert r.json()["email"] == "ana@example.edu"
    ben_sessions = client.get("/v1/account/sessions", headers=auth(ben)).json()
    ana_sessions = client.get("/v1/account/sessions", headers=auth(ana)).json()
    assert len(ana_sessions) == 1 and ana_sessions[0]["id"] != ben_sessions[0]["id"]
    # Ana can't sign Ben out by guessing his session id; it looks like it doesn't exist.
    r = client.delete(f"/v1/account/sessions/{ben_sessions[0]['id']}", headers=auth(ana))
    assert r.status_code == 404
    assert client.get("/v1/account", headers=auth(ben)).status_code == 200
    # Deleting with Ben's id in the body still only deletes Ana.
    r = client.post("/v1/account/delete", json={"password": PASSWORD, "user_id": ben_id}, headers=auth(ana))
    assert r.status_code == 200
    assert client.get("/v1/account", headers=auth(ben)).json()["email"] == "ben@example.edu"
    assert [e for (e,) in q("select email from users")] == ["ben@example.edu"]


def test_change_password_keeps_this_device_and_signs_out_others(client):
    here = signup(client)
    other = client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": PASSWORD, "device": "Laptop"}).json()["token"]
    r = client.post("/v1/account/password", json={"current_password": "wrong one", "new_password": "a new password"}, headers=auth(here))
    assert r.status_code == 401 and r.json()["error"]["code"] == "wrong_password"
    r = client.post("/v1/account/password", json={"current_password": PASSWORD, "new_password": "a new password"}, headers=auth(here))
    assert r.status_code == 200
    assert client.get("/v1/account", headers=auth(here)).status_code == 200
    assert client.get("/v1/account", headers=auth(other)).status_code == 401
    assert client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "a new password"}).status_code == 200


def test_sessions_list_and_revoke(client):
    here = signup(client)
    other = client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": PASSWORD, "device": "Laptop"}).json()["token"]
    rows = client.get("/v1/account/sessions", headers=auth(here)).json()
    assert len(rows) == 2 and sum(r["current"] for r in rows) == 1
    laptop = next(r for r in rows if r["device"] == "Laptop")
    assert client.delete(f"/v1/account/sessions/{laptop['id']}", headers=auth(here)).status_code == 200
    assert client.get("/v1/account", headers=auth(other)).status_code == 401
    third = client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": PASSWORD}).json()["token"]
    assert client.post("/v1/account/sessions/revoke-others", headers=auth(here)).status_code == 200
    assert client.get("/v1/account", headers=auth(third)).status_code == 401
    assert client.get("/v1/account", headers=auth(here)).status_code == 200


def test_delete_account_needs_the_password_and_removes_everything(client):
    token = signup(client)
    assert client.post("/v1/account/delete", json={"password": "wrong one"}, headers=auth(token)).status_code == 401
    assert q("select count(*) from users")[0][0] == 1
    assert client.post("/v1/account/delete", json={"password": PASSWORD}, headers=auth(token)).status_code == 200
    assert q("select (select count(*) from users), (select count(*) from sessions), (select count(*) from email_codes)")[0] == (0, 0, 0)
    assert client.get("/v1/account", headers=auth(token)).status_code == 401
    # The email can be used again for a new account.
    signup(client)


def test_logs_never_contain_passwords_codes_or_tokens(client, caplog):
    caplog.set_level(logging.DEBUG)
    token = signup(client)
    client.post("/v1/auth/password-reset/request", json={"email": "ana@example.edu"})
    code = last_code("ana@example.edu")
    client.post("/v1/auth/login", json={"email": "ana@example.edu", "password": "wrong password"})
    client.post("/v1/account/password", json={"current_password": PASSWORD, "new_password": "a new password"}, headers=auth(token))
    logs = caplog.text
    for secret in (PASSWORD, "wrong password", "a new password", code, token):
        assert secret not in logs
