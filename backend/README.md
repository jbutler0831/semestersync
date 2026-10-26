# SemesterSync account server

Optional accounts and cloud sync for the SemesterSync desktop app: create an account with an email and password, sign in and out, reset a forgotten password, change the password, see and sign out signed-in computers, delete the account, keep courses in sync between computers (only after the person agrees, in the app), and host study rooms.

FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 17, Argon2id (`argon2-cffi`). The desktop app talks to it over HTTPS and never connects to the database.

## Run it on your computer

**With Docker** (recommended). Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), then:

```bash
cd backend
cp .env.example .env          # then put a random TOKEN_PEPPER in it (the file says how)
docker compose up --build
```

- API: http://localhost:8000 (interactive docs at http://localhost:8000/docs)
- Emails (Mailpit): http://localhost:8025, where every code the server sends shows up. Nothing is really emailed.
- Every port listens on 127.0.0.1 only, so nothing is reachable from other computers.

Then run the app against it: `SEMESTERSYNC_API_URL=http://localhost:8000 npm start` from the repository folder.

**Without Docker** (macOS with Homebrew):

```bash
brew install postgresql@17 python@3.13
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
scripts/serve-test.sh          # throwaway database; emails are printed in this window
```

`serve-test.sh` serves on http://127.0.0.1:8765 and deletes its database when you stop it (Ctrl+C).

## Tests

```bash
backend/scripts/test.sh        # or: npm run test:backend
npm run test:accounts          # the real desktop app against this server
```

`test.sh` creates a temporary PostgreSQL cluster in a temp folder (never your real database), applies the migrations, checks that the migration matches the models, and runs the tests in `tests/`. It needs the PostgreSQL 17 programs (`brew install postgresql@17`, or set `PG_BIN`) and `backend/.venv`.

## API

All requests and responses are JSON. Errors look like `{"error": {"code": "...", "message": "..."}}`, where `message` is written to show to people. Signed-in calls send `Authorization: Bearer <token>`.

| Method and path | Body | Answer |
|---|---|---|
| `POST /v1/auth/register` | `email`, `password`, `device` | `201` session: `token`, `expires_at`, `user`. Nothing is emailed. `409 email_taken` if the email already has an account. |
| `POST /v1/auth/login` | `email`, `password`, `device` | `200` session; `401 invalid_credentials` for a wrong email or password (same answer for both) |
| `POST /v1/auth/logout` | | Ends this session |
| `POST /v1/auth/password-reset/request` | `email` | `202`, the same answer whether or not the account exists |
| `POST /v1/auth/password-reset/confirm` | `email`, `code`, `new_password` | Sets the password and ends every session |
| `GET /v1/account` | | `id`, `email`, `email_verified` (true once a reset code has proved the person reads that inbox), `created_at` |
| `POST /v1/account/password` | `current_password`, `new_password` | Ends every other session |
| `GET /v1/account/sessions` | | Signed-in computers: `id`, `device`, `created_at`, `last_seen_at`, `current` |
| `DELETE /v1/account/sessions/{id}` | | Signs that computer out (`404` if it isn't one of yours) |
| `POST /v1/account/sessions/revoke-others` | | Signs out every other computer |
| `POST /v1/account/delete` | `password` | Deletes the account and everything attached to it, at once |
| `GET /v1/sync/changes?since=<n>` | | Your documents changed after change number `n`, 100 at a time: `docs` (each `doc_id`, `version`, `seq`, `deleted`, `body`, `device`, `updated_at`), `cursor`, `more`, `epoch`, and `reset` when deletion markers older than `n` were purged (compare everything) |
| `POST /v1/sync/push` | `changes`: up to 50 of `{doc_id, base_version, body}` or `{doc_id, base_version, deleted: true}` | Per document: `ok` with the new `version`; `conflict` with the server's copy when `base_version` isn't the current version; or `rejected` (`too_large`, `quota`, `invalid_body`) |
| `GET /v1/sync/usage` | | `docs`, `bytes`, `max_docs`, `max_bytes` |
| `POST /v1/sync/clear` | `password` | Deletes all your synced documents and raises `epoch`, so every computer turns sync off. The account stays. |
| `WebSocket /v1/rooms/{code}` | | A study room (no account needed; see below) |
| `GET /healthz` | | `{"status":"ok"}` when the database answers |

`device` is a short label the app sends, like "Mac · SemesterSync 1.5.0", so people can tell their computers apart.

**Sync documents** are a course (`course-<id>`), the Inbox (`course-inbox`), settings and history (`extras`), or a study set (`deck-<id>`). The server stores each body as sent (JSON, at most 1 MB) and never reads inside it; combining edits happens in the app. Every change raises the document's `version` and the person's change counter `seq`. A write only applies if `base_version` equals the current version (compare-and-swap), so an edit made without seeing the latest copy is never accepted. Deleted documents keep a marker (no body) for 90 days so other computers learn of the deletion. Limits: 300 documents and 25 MB per person; a push request can be up to 4 MB.

**Study rooms** are a WebSocket at `/v1/rooms/{code}` (4 to 8 capital letters or digits). The server says `{"t":"hello","you":id}`, then sends `{"t":"peers","you","peers":[{id,name,task,timer}]}` whenever someone joins, leaves or changes their status, and `{"t":"chat",id,name,text}` for others' messages. The app sends `{"t":"presence",name,task,timer}` and `{"t":"chat",text}`. Nothing is stored: rooms exist only in the server's memory while someone is in them, so the API runs as one process. Chat names come from the sender's own presence, so nobody can post as someone else. When the server refuses or closes a connection it sends `{"t":"error",message}` first. Limits: 50 people a room, 2,000 rooms, 5 open connections and 60 joins an hour per IP address, 20 messages per 10 seconds and 2 KB a message per connection.

## Security

- **Passwords** are hashed with Argon2id (`argon2-cffi`'s recommended settings) and rehashed on sign-in when those settings change. Wrong emails take as long to check as wrong passwords.
- **Sessions** are 32 random bytes from `secrets`. The database keeps only an HMAC-SHA256 of each token, keyed with `TOKEN_PEPPER`, so a copy of the database alone can't be used to sign in. Sessions last 60 days and can be ended from any signed-in computer.
- **Codes** are only for password reset: 6 random digits, stored the same way, valid 15 minutes, 5 wrong tries, tied to one account. Asking for a new code cancels the old one.
- **Sign-up doesn't check the email**, by choice: it's quicker, and email is needed only to reset a password. So someone could sign up with an address that isn't theirs; that address's owner can take the account over at any time with a reset, which signs everyone else out. Sign-up says when an email already has an account (sign-in and reset never reveal it), and is limited to 20 accounts per IP address per hour.
- **Who you are** comes only from the session token. No endpoint takes a user ID, and IDs in paths only choose among your own rows. The tests check that one person can't see, sign out or delete another.
- **Rate limits** are kept in the database, so they hold across restarts: sign-in 10 per email and 30 per IP address per 15 minutes; sign-up 20 per IP address per hour; reset emails 5 per address and 20 per IP address per hour; codes 30 per IP address per hour; password checks 10 per account per 15 minutes; sync 120 pushes and 600 pulls per account per hour.
- **Study room names, tasks and chat are never logged or stored**, and the server keeps no access logs (paths contain room codes).
- **Synced course content is never logged.** Sync documents are stored as sent and only the owner's session can read them. They're encrypted in transit (HTTPS) and should be on an encrypted disk, but not end to end.
- **Nothing secret is logged or echoed.** Validation errors name the field without repeating what was sent, there are no access logs of request bodies, and the tests check the logs for passwords, codes and tokens. Responses are marked `Cache-Control: no-store`.
- Request bodies over 16 KB are refused (4 MB for `/v1/sync/push`). In production, the reverse proxy should enforce the same limits.
- No custom cryptography: only `argon2-cffi`, `secrets` and `hmac`.

## Settings

All settings come from environment variables (or `backend/.env` while developing; it's ignored by git). See `.env.example`.

| Variable | |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://user:password@host:5432/db` |
| `TOKEN_PEPPER` | At least 32 random characters. Changing it signs everyone out and cancels outstanding codes. |
| `APP_ENV` | `development`, `test` or `production` (production turns off `/docs` and refuses the console email backend) |
| `EMAIL_BACKEND` | `smtp`, `console` (prints emails; development only) or `memory` (tests) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS`, `SMTP_SSL`, `EMAIL_FROM` | Outgoing email |
| `TRUST_PROXY` | `true` only behind your own reverse proxy, so rate limits use the real client address |

## Production (not deployed)

Nothing has been deployed, and nothing will be without your go-ahead. `deploy/` has everything for one Linux server with Docker: the API, PostgreSQL on an internal network, and Caddy for HTTPS (certificates from Let's Encrypt). Decisions about hosting and email are in `docs/stage5-release-plan.md`.

1. Point a DNS name (for example `api.your-domain`) at the server. Open only ports 22, 80 and 443.
2. Copy the `backend/` folder to the server, then:
   ```bash
   cd backend/deploy
   cp .env.production.example .env.production   # fill in every value; new secrets, never the development ones
   chmod 600 .env.production
   docker compose --env-file .env.production up -d --build
   curl https://api.your-domain/healthz          # {"status":"ok"}
   ```
3. Back up every day: install [age](https://age-encryption.org), make a key pair with `age-keygen` **on your own computer**, put the public key in `BACKUP_AGE_RECIPIENT`, and add `0 4 * * * /path/to/backend/deploy/backup.sh` to cron. Copy the backups off the server too. The restore command is in `backup.sh`.
4. Set `apiUrl` in `src/config.json` to `https://api.your-domain` before building the installers.

What the setup does:

- Secrets are only in `.env.production` on the server. It's ignored by git and left out of the Docker image.
- Caddy enforces the body limits (16 KB, 4 MB for `/v1/sync/push`), sets HSTS, keeps no access logs and replaces any `X-Forwarded-For` the client sent, so `TRUST_PROXY=true` is safe.
- The database has no public port, and the API is reachable only through Caddy.
- The API runs as a single process, which study rooms need. Migrations run on every start and are safe to repeat.
- Production refuses to start without real email (`EMAIL_BACKEND=smtp`) and with rate limits off.
