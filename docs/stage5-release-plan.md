# Stage 5: Release 1.5.0, plan and decisions

Status: **prepared, waiting on your decisions.** Nothing is deployed, pushed to `main`, tagged or published.

## Done in this stage (branch `stage5/release`)

- **Study rooms moved to SemesterSync's own server.** They used to run through Supabase Realtime. Now they use a WebSocket at `/v1/rooms/<code>`. As before, no account is needed and nothing is stored. Names, tasks and chat are cleaned on the server and never logged. Limits: 50 people a room, 5 open rooms and 60 joins an hour per network, 20 messages per 10 seconds, 2 KB a message. If the connection drops, the app reconnects by itself.
- **Version 1.5.0** in `package.json`, `package-lock.json` and the README.
- **Production server files** (`backend/deploy/`):
  - `compose.yml` runs the API, PostgreSQL and Caddy. Only Caddy is public, and the database is on an internal network.
  - `Caddyfile` sets up HTTPS through Let's Encrypt, the body limits and no access logs.
  - `.env.production.example` lists every setting. The real file stays on the server.
  - `backup.sh` makes daily backups encrypted with age and keeps 14.
  - The server image no longer writes access logs, which would contain room codes.
- **Release notes:** `docs/RELEASE_NOTES-1.5.0.md`.

## What's still on Supabase

Only the **one-time copy of old accounts** (versions 1.0 to 1.4) remains, in `src/legacy.js`. It copies the courses of someone signed in to an old account onto their computer the first time 1.5 runs.

- **Recommendation:** keep the Supabase project, unchanged and free, until the end of the spring 2027 semester, so that people who update late still get their courses.
- **After that:** a small release removes `legacy.js` and the Supabase package, then you delete the project.
- Their courses are already on their computers in 1.4 as well, so this is a safety net, not the only copy.

## Decisions for you

### 1. Where the server runs

The server needs to be a small Linux machine (1 to 2 GB of memory) with Docker. It runs one API process, PostgreSQL and Caddy.

| Option | About | Notes |
|---|---|---|
| **Hetzner Cloud, smallest shared plan (CX23 or similar)** (recommended) | €4 to €6 a month | The best value. Data centers are in Germany, Finland and the US. Prices went up in April 2026, so check hetzner.com/cloud. |
| DigitalOcean, 1 GB Droplet | about $6 a month | Simple. The $4, 512 MB plan is too small for PostgreSQL. The GitHub Student Pack credit seems to have ended in July 2026, so check your Billing page. |
| Your own computer or a campus server | free | Not recommended: it has to stay on, and it has to be reachable for HTTPS. |

### 2. Email (sign-up and password reset codes)

| Option | Free amount | Notes |
|---|---|---|
| **Resend** (recommended) | about 3,000 a month, 100 a day | Simple SMTP. You confirm a domain with a few DNS records. |
| Brevo | about 300 a day | More generous free plan. The account comes with marketing features. |
| Postmark | 100 a month | Best delivery, but it costs about $15 a month for real use. |
| Amazon SES | cheapest at volume | Most setup, and it starts in a sandbox. |

Every option needs a **domain** that you own (about $10 to $15 a year), both for email and for the API address, for example `api.<your-domain>`.

### 3. Signing the installers (optional)

Without signing, macOS and Windows warn the first time someone opens the app, as they did with 1.4. The cost is $99 a year for Apple. The cost of Windows signing varies. The CI already uses signing certificates automatically once the secrets exist.

## Release steps, each needing your go-ahead

1. **Push `stage4/sync` and `stage5/release`, and open a pull request** into `main`, so that CI runs every test on Mac and Windows. This doesn't publish anything.
2. **Buy the domain and create the email and server accounts.** You do this, because I won't create accounts or spend money for you.
3. **Deploy.** Following `backend/README.md`, under Production, with you on the server or with me guiding you.
   - Check `https://api.<domain>/healthz`.
   - Create a test account, test sync, then delete the test account.
4. **Point the app at it** by setting `apiUrl` in `src/config.json`, then rebuild.
5. **Merge to `main` and tag `v1.5.0`.** CI then builds, checks and publishes the installers on the Releases page.

## Not tested yet

- Docker, `compose.yml`, the Caddyfile and `backup.sh`, because Docker and Caddy aren't installed on this Mac. They need a real run on the server, step 3.
- Windows. CI covers it once the pull request is open.
- A study room reconnecting after the connection drops. The code handles it, but no test breaks the connection yet.
