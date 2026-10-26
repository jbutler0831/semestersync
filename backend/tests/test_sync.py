import json
from sqlalchemy import text
from app.db import engine
from conftest import PASSWORD, auth, signup

COURSE = json.dumps({"id": "c1", "code": "BIO 150", "items": []})


def q(sql, **kw):
    with engine().begin() as c:
        r = c.execute(text(sql), kw)
        return r.all() if r.returns_rows else None


def push(client, token, *changes):
    r = client.post("/v1/sync/push", json={"changes": list(changes)}, headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()["results"]


def changes(client, token, since=0):
    r = client.get(f"/v1/sync/changes?since={since}", headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def test_account_says_sync_is_available(client):
    t = signup(client)
    assert client.get("/v1/account", headers=auth(t)).json()["sync_available"] is True


def test_push_then_pull_with_versions_and_cursor(client):
    t = signup(client)
    assert changes(client, t) == {"docs": [], "cursor": 0, "more": False, "epoch": 1, "reset": False}
    r, = push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": COURSE})
    assert r["status"] == "ok" and r["version"] == 1
    ch = changes(client, t)
    assert [d["doc_id"] for d in ch["docs"]] == ["course-c1"] and ch["docs"][0]["body"] == COURSE and ch["docs"][0]["device"] == "Test Mac"
    assert changes(client, t, ch["cursor"])["docs"] == []
    r, = push(client, t, {"doc_id": "course-c1", "base_version": 1, "body": COURSE.replace("BIO", "CHEM")})
    assert r["version"] == 2
    later = changes(client, t, ch["cursor"])
    assert len(later["docs"]) == 1 and "CHEM" in later["docs"][0]["body"]


def test_stale_writes_are_refused_with_the_current_copy(client):
    t = signup(client)
    push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": COURSE})
    push(client, t, {"doc_id": "course-c1", "base_version": 1, "body": COURSE.replace("BIO", "A")})
    r, = push(client, t, {"doc_id": "course-c1", "base_version": 1, "body": COURSE.replace("BIO", "B")})
    assert r["status"] == "conflict" and r["server"]["version"] == 2 and '"A 150"' in r["server"]["body"]
    # Creating a document that already exists is a conflict too.
    r, = push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": COURSE})
    assert r["status"] == "conflict"
    assert q("select version from sync_docs")[0][0] == 2


def test_deletions_are_kept_as_markers(client):
    t = signup(client)
    push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": COURSE})
    cur = changes(client, t)["cursor"]
    r, = push(client, t, {"doc_id": "course-c1", "base_version": 1, "deleted": True})
    assert r["status"] == "ok" and r["version"] == 2
    d, = changes(client, t, cur)["docs"]
    assert d["deleted"] and d["body"] is None
    assert q("select body, size from sync_docs") == [(None, 0)]
    # It can be created again from the marker's version.
    r, = push(client, t, {"doc_id": "course-c1", "base_version": 2, "body": COURSE})
    assert r["status"] == "ok" and r["version"] == 3


def test_old_markers_are_purged_and_old_cursors_reset(client):
    t = signup(client)
    push(client, t, {"doc_id": "course-a", "base_version": 0, "body": COURSE}, {"doc_id": "course-b", "base_version": 0, "body": COURSE})
    cur = changes(client, t)["cursor"]
    push(client, t, {"doc_id": "course-a", "base_version": 1, "deleted": True})
    q("update sync_docs set updated_at = now() - interval '91 days' where doc_id = 'course-a'")
    push(client, t, {"doc_id": "course-b", "base_version": 1, "body": COURSE})
    assert [d for (d,) in q("select doc_id from sync_docs")] == ["course-b"]
    assert changes(client, t, cur)["reset"] is True
    assert changes(client, t, 0)["reset"] is False


def test_paging(client):
    t = signup(client)
    for i in range(0, 120, 50):
        push(client, t, *[{"doc_id": f"deck-d{n}", "base_version": 0, "body": "{}"} for n in range(i, min(i + 50, 120))])
    a = changes(client, t)
    assert len(a["docs"]) == 100 and a["more"]
    b = changes(client, t, a["cursor"])
    assert len(b["docs"]) == 20 and not b["more"]


def test_people_never_see_or_touch_each_others_documents(client):
    ana, ben = signup(client, "ana@example.edu"), signup(client, "ben@example.edu")
    push(client, ana, {"doc_id": "course-c1", "base_version": 0, "body": COURSE})
    assert changes(client, ben)["docs"] == []
    # Ben writing the same document id makes his own document; Ana's is untouched.
    r, = push(client, ben, {"doc_id": "course-c1", "base_version": 0, "body": COURSE.replace("BIO", "BEN")})
    assert r["status"] == "ok" and r["version"] == 1
    assert "BIO" in changes(client, ana)["docs"][0]["body"]
    r, = push(client, ben, {"doc_id": "course-c1", "base_version": 1, "deleted": True})
    assert changes(client, ana)["docs"][0]["deleted"] is False
    # A user id in the request is ignored.
    ana_id = client.get("/v1/account", headers=auth(ana)).json()["id"]
    r = client.post("/v1/sync/push", json={"user_id": ana_id, "changes": [{"doc_id": "extras", "base_version": 0, "body": "{}"}]}, headers=auth(ben))
    assert r.status_code == 200 and changes(client, ana)["docs"][-1]["doc_id"] == "course-c1"
    assert client.get("/v1/sync/changes", headers={}).status_code == 401


def test_bad_documents_are_refused(client):
    t = signup(client)
    for change in [{"doc_id": "../etc", "base_version": 0, "body": "{}"}, {"doc_id": "course-c1", "base_version": -1, "body": "{}"},
                   {"doc_id": "course-c1", "base_version": 0}, {"doc_id": "course-c1", "base_version": 0, "body": "{}", "deleted": True}]:
        assert client.post("/v1/sync/push", json={"changes": [change]}, headers=auth(t)).status_code == 422
    r, = push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": "not json"})
    assert r["status"] == "rejected" and r["code"] == "invalid_body"
    big = json.dumps({"text": "x" * 1_000_001})
    r, = push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": big})
    assert r["status"] == "rejected" and r["code"] == "too_large"
    two = {"doc_id": "extras", "base_version": 0, "body": "{}"}
    assert client.post("/v1/sync/push", json={"changes": [two, two]}, headers=auth(t)).status_code == 422
    assert client.post("/v1/sync/push", json={"changes": [two] * 51}, headers=auth(t)).status_code == 422
    assert q("select count(*) from sync_docs")[0][0] == 0


def test_storage_limit(client):
    t = signup(client)
    q("insert into sync_docs (user_id, doc_id, body, size, version, seq) select id, 'deck-big', '{}', 25*1024*1024 - 10, 1, 1 from users")
    r, = push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": COURSE})
    assert r["status"] == "rejected" and r["code"] == "quota"
    u = client.get("/v1/sync/usage", headers=auth(t)).json()
    assert u["docs"] == 1 and u["max_bytes"] == 25 * 1024 * 1024


def test_clear_removes_synced_data_and_keeps_the_account(client):
    t = signup(client)
    push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": COURSE})
    assert client.post("/v1/sync/clear", json={"password": "wrong one"}, headers=auth(t)).status_code == 401
    assert client.post("/v1/sync/clear", json={"password": PASSWORD}, headers=auth(t)).status_code == 200
    ch = changes(client, t)
    assert ch["docs"] == [] and ch["epoch"] == 2
    assert client.get("/v1/account", headers=auth(t)).status_code == 200


def test_deleting_the_account_deletes_synced_data(client):
    t = signup(client)
    push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": COURSE})
    client.post("/v1/account/delete", json={"password": PASSWORD}, headers=auth(t))
    assert q("select count(*) from sync_docs")[0][0] == 0


def test_large_batches_fit_but_other_endpoints_stay_small(client):
    t = signup(client)
    body = json.dumps({"text": "x" * 600_000})
    rs = push(client, t, *[{"doc_id": f"deck-d{n}", "base_version": 0, "body": body} for n in range(5)])
    assert all(r["status"] == "ok" for r in rs)
    r = client.post("/v1/auth/login", content=b"{" + b" " * 20000 + b"}", headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_sync_bodies_are_not_logged(client, caplog):
    import logging
    caplog.set_level(logging.DEBUG)
    t = signup(client)
    secret = json.dumps({"id": "c1", "notes": "private note 4471"})
    push(client, t, {"doc_id": "course-c1", "base_version": 0, "body": secret})
    changes(client, t)
    assert "private note 4471" not in caplog.text


def test_rate_limit_on_push(client):
    t = signup(client)
    q("insert into rate_events (key) select 'sync-push:' || id from users, generate_series(1, 120)")
    r = client.post("/v1/sync/push", json={"changes": []}, headers=auth(t))
    assert r.status_code == 429
