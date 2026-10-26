#!/usr/bin/env bash
# Runs the backend tests against a throwaway PostgreSQL cluster in a temp folder (never your real database).
# Needs PostgreSQL 17 binaries: `brew install postgresql@17`, or set PG_BIN.
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-$(brew --prefix postgresql@17 2>/dev/null)/bin}"
[ -x "$PG_BIN/initdb" ] || PG_BIN="$(dirname "$(command -v initdb)")"
DIR="$(mktemp -d)"
PORT="${PG_TEST_PORT:-54329}"
cleanup() { "$PG_BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$DIR/data" -U test --auth=trust >/dev/null
"$PG_BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
"$PG_BIN/createdb" -h "$DIR" -p "$PORT" -U test semestersync_test
export APP_ENV=test
export DATABASE_URL="postgresql+psycopg://test@/semestersync_test?host=$DIR&port=$PORT"
export TOKEN_PEPPER="test-pepper-not-a-secret-0123456789abcdef"
export EMAIL_BACKEND=memory
PY="${PYTHON:-.venv/bin/python}"
"$(dirname "$PY")/alembic" upgrade head  # the plain command, as CI and the Docker image run it
"$PY" -m alembic check  # the migration matches app/models.py
"$(dirname "$PY")/pytest" -q "$@"  # the plain command, as CI runs it
