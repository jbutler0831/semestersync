#!/usr/bin/env bash
# Starts the API on http://127.0.0.1:${API_TEST_PORT:-8765} with a throwaway PostgreSQL cluster, for the desktop
# app's account tests. Emails are printed to stdout instead of being sent. Everything is deleted on exit.
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-$(brew --prefix postgresql@17 2>/dev/null)/bin}"
[ -x "$PG_BIN/initdb" ] || PG_BIN="$(dirname "$(command -v initdb)")"
DIR="$(mktemp -d)"
PORT="${PG_TEST_PORT:-54330}"
child=""
cleanup() { [ -n "$child" ] && kill "$child" 2>/dev/null; wait 2>/dev/null; "$PG_BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
trap 'exit 0' TERM INT
"$PG_BIN/initdb" -D "$DIR/data" -U test --auth=trust >/dev/null
"$PG_BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
"$PG_BIN/createdb" -h "$DIR" -p "$PORT" -U test semestersync_test
export APP_ENV=test
export DATABASE_URL="postgresql+psycopg://test@/semestersync_test?host=$DIR&port=$PORT"
export TOKEN_PEPPER="test-pepper-not-a-secret-0123456789abcdef"
export EMAIL_BACKEND=console
PY="${PYTHON:-.venv/bin/python}"
"$PY" -m alembic upgrade head 2>/dev/null
"$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "${API_TEST_PORT:-8765}" --no-access-log &
child=$!
wait "$child"
