# Stage 4: Opt-in cloud sync, design for review

Status: **draft, waiting for approval.** No sync code gets written until the decisions at the end are settled.

## Goals

- Someone with an account can choose to keep some or all of their courses in it, and see them on every computer they sign in on.
- The computer stays the source of truth. Every feature keeps working offline and without an account, and a complete copy always stays local.
- Nothing is uploaded until the person agrees, and they can see exactly what will go.
- No edit is ever silently lost. When two computers change the same thing and the app can't safely combine them, the person decides.
- The server only ever acts for the signed-in person. It never trusts an ID the app sends.

**Not in this stage:** syncing original syllabus files (the PDFs in `Sources/`), sharing with other people, study rooms on our own server, real-time push (changes arrive on focus and every couple of minutes, as now), and the web version.

## What's wrong with the sync we have

The page already syncs to a document store (built for the Supabase table and the web artifact). It works, but it has three weaknesses worth fixing before it runs against our own server:

1. **No versions.** Each save reads the whole collection, then writes. If two computers save in the same moment, the second write silently replaces the first.
2. **"Newer edit wins."** When both sides changed a course, the older edit goes to Safety copies. Nothing is lost, but people don't notice, and they lose work they didn't know they had to rescue.
3. **All or nothing.** Every course syncs, or none does.

## Data model

### On the server: one new table

`sync_docs`, one row per document:

| Column | |
|---|---|
| `user_id` | Owner. Always taken from the session, never from the request. Deleting the account removes the rows (ON DELETE CASCADE). |
| `doc_id` | `course-<id>`, `course-inbox`, `extras`, or `deck-<id>`, checked with a strict pattern |
| `body` | The document exactly as the app writes it (a JSON string). The server stores it but doesn't read inside it. |
| `version` | Goes up by 1 on every change to this document |
| `seq` | A per-person counter, raised on every change to any of their documents, so "what changed since I last looked" is one query |
| `deleted` | A deletion marker (tombstone), so other computers learn about deletions. The body is cleared. |
| `updated_at`, `device` | For "changed on Windows PC, 2 hours ago" in the conflict list |

Primary key `(user_id, doc_id)`, plus an index on `(user_id, seq)`.

**Documents stay the same as today:** one per course (deliverables, scores, notes and syllabus text), the Inbox, one for settings and study history, and one per study set. Old backups and the existing merge code keep working.

**Limits:**

| Limit | Value |
|---|---|
| Size of one document | 1 MB (the largest real course with a long syllabus is about 100 KB) |
| Documents per person | 300 (8 courses + Inbox + settings + up to 100 study sets, with room to spare) |
| Total storage per person | 25 MB |

The general 16 KB request limit stays for every other endpoint.

### On the computer

The local copy (`ssync-courses-v1`, `ssync-extras-v1`) stays exactly as it is. One new key per account, `ssync-sync-<user id>`, records:

- the server cursor (the last `seq` seen)
- for each synced document: the `version` this computer last saw, and the text it had then (the "base" for merging, as now)
- which courses are chosen for sync
- open conflicts

## API

All routes need a session, and every query filters on the session's user.

| Route | |
|---|---|
| `GET /v1/sync/changes?since=<seq>` | Every document of yours changed after `seq`, including deletions, up to 100 at a time (`more: true` means ask again). `since=0` returns everything. |
| `POST /v1/sync/push` | A batch of changes, each `{doc_id, base_version, body}` or `{doc_id, base_version, deleted: true}`. A new document uses `base_version: 0`. |
| `GET /v1/sync/usage` | Documents and bytes used, for **Your data** |
| `POST /v1/sync/clear` | Removes all your synced data from the server and keeps the account (password required) |

**Push uses compare-and-swap.** A change is applied only if the server's version still equals `base_version`. Otherwise that item comes back as a conflict, with the server's current copy, and the rest of the batch still applies. This one rule removes the simultaneous-write problem: the server never accepts an edit made without seeing the latest version.

## How a sync runs

These are the same triggers as now: shortly after an edit, when the window comes back into focus, every 2 minutes, and when the connection returns.

1. **Pull:** `GET /changes?since=cursor`. For each changed document:
   - If this computer hasn't changed it since the base, take the server's copy.
   - If this computer has changed it, merge (see below).
2. **Push** this computer's changes with their base versions.
3. **A push conflict** (someone else saved in between) means: pull that document, merge, and push again once. If it's still contested, it goes to **Needs your choice**.
4. Save the local copy, the new versions and the cursor.

Offline, everything saves locally, the status says **Offline**, and the existing retry timing (5 s, 15 s, 30 s, then every minute or two) carries on.

## Conflicts

**Combine automatically when it's safe.** When both computers changed the same course, the app compares them deliverable by deliverable (each has a stable ID), using the base to tell what each side did:

- A deliverable added on one side is kept.
- A deliverable deleted on one side and untouched on the other is deleted.
- Different fields of the same deliverable changed on each side (a score on one computer, the due date on the other) are combined.
- Course details (title, credits, target grade, categories) are compared field by field the same way.

**Ask when it isn't safe.** That covers the same field changed to different values on both sides, or a deliverable deleted on one side and edited on the other. The course goes to a **Needs your choice** list. A badge appears on **Your data**, and the save status reads **1 change needs your choice**. Each entry shows both versions side by side (for example "Midterm: due Oct 14 on this Mac, due Oct 16 on Windows PC, 2 h ago") with three buttons:

- **Keep this computer's**
- **Keep the other**
- **Keep both** (the other version becomes a separate course, "BIO 150 (other copy)")

Until the person decides, this computer keeps using and showing its own version, and doesn't push that course. Every other course keeps syncing. Whichever side isn't kept also goes to Safety copies, as now.

**Settings and study history** combine without asking:

- Reminder and planner settings: the newer change wins, per setting.
- Study history, weak spots and review logs: each entry has an ID or timestamp, so both sides' entries are kept.

**Study sets** combine card by card, like deliverables. A card edited on both sides goes to **Needs your choice**.

**Deleting a whole course on one computer** removes it on the others. Each of those computers keeps it in Safety copies first. If the other computer had edited it in the meantime, it goes to **Needs your choice** ("Deleted on Windows PC, but you changed it here").

## Choosing what syncs

**First time (consent).** After signing in, or from **Your data → Turn on cloud sync…**, a dialog lists every course on this computer with a checkbox (all ticked, samples excluded), plus "Settings and study history". It says what each one contains: deliverables, scores, notes, syllabus text and study sets. Nothing is uploaded until **Upload and turn on sync**. **Not now** uploads nothing and keeps sync off.

**If the account already has courses**, the dialog shows them too, and what will happen:

- Courses only in the account are added here.
- Courses only on this computer are uploaded if ticked.
- The same course in both is combined as above, and goes to **Needs your choice** when it can't be combined.

**Later**, each course gets a **Sync to account** switch in its settings:

- Turning it **on** uploads the course after a one-line confirmation.
- Turning it **off** asks whether to **remove it from the account** (other computers keep a safety copy) or **keep the account's copy but stop updating it**.
- A course switched off is never uploaded, and the course list marks it "only on this computer".

Study sets follow their course. The Inbox follows "Settings and study history".

**Turning sync off entirely**, or signing out, keeps everything local (as now). **Remove my data from the account** in **Your data** clears the server and keeps the account.

## Migration

- **Server:** one Alembic migration adds `sync_docs`. Nothing existing changes.
- **Computers:**
  - Nobody has synced to the new server yet, so every first sync goes through the consent dialog above.
  - The Stage 2 consent keys and old account caches were cleared by the Stage 3 old-account copy, so nothing syncs by surprise.
  - Before a computer's first sync, the app writes a backup file (`SemesterSync-before-first-sync-….json`), as it did for the upgrade.
- **The web version** keeps its Claude storage. It's untouched.

## Security

- **Ownership:** every query includes `user_id = session user`. Tests check that one person can't read, overwrite, delete or even detect another person's documents by guessing IDs.
- **Validation:** document IDs are checked against a strict pattern. Bodies must be JSON strings under the size limit. The server never runs or interprets what's inside them.
- **Logging:** bodies are never logged. Logs record only counts and document IDs.
- **Rate limits:** push 120 per hour per account and pull 600 per hour, generous for normal use, so a broken client can't hammer the server.
- **Encryption:** the data is encrypted in transit (HTTPS) and at rest by the database host's disk encryption. It isn't end-to-end encrypted, so the server could technically read it. See decision 1.

## Tests (before anything ships)

- **Server tests:** versioning and compare-and-swap, the `changes` cursor and paging, tombstones, limits, cross-user isolation, account deletion removing sync data, rate limits, and nothing logged.
- **App tests against a fake server** (the existing 185 checks, adapted):
  - consent with per-course ticks
  - each automatic merge case
  - each "Needs your choice" case and all three buttons
  - per-course on/off, and deletions
  - offline then back online
  - two computers saving at the same moment
- **App tests against the real server** (like `test:accounts`): two app windows syncing through it, including a simultaneous edit.
- **Upgrade test:** a computer from 1.4 data through to the first sync, with nothing lost.

## Work plan, once approved

1. Server: table, endpoints, tests.
2. App: replace the document shim with versioned sync; keep the local store as is.
3. App: deliverable-level merge and the **Needs your choice** list.
4. App: consent dialog with ticks, and the per-course switch.
5. Tests, docs, then the end-of-stage report.

## Decisions for you

1. **End-to-end encryption?** I recommend **no for now**. With it, the server couldn't read anyone's courses, but forgetting your password would make the synced copy unreadable (reset couldn't recover it), and it adds a lot of complexity. The computer's own copy would still be safe either way. It can be added later.
2. **New courses after sync is on:** sync them automatically, or ask each time? I recommend **sync automatically**, with the switch on each course to turn it off.
3. **How long deletion markers stay on the server:** I recommend **90 days**. A computer that's been offline longer than that does a full comparison instead, which still loses nothing.
4. **Storage limit per person:** I recommend **25 MB**, far more than a semester needs.
5. **Automatic merging:** combine non-overlapping edits automatically (recommended), or always ask when both computers changed a course?
