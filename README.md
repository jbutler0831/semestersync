# SemesterSync (desktop)

**[Download for Mac or Windows](https://github.com/jbutler0831/semestersync/releases/latest)**

A Mac and Windows app that turns course syllabi into a semester plan: every dated deliverable, each course's grading breakdown, a workload heatmap that shows where courses collide, and calendar export.

## Install

**Mac:** download `SemesterSync-…-universal.dmg`, open it and drag SemesterSync into Applications. The app isn't signed by Apple yet, so the first time you open it macOS says it "could not verify SemesterSync is free of malware". To open it anyway:
1. Click **Done** on the warning (not Move to Trash).
2. Open **System Settings → Privacy & Security**, scroll down to Security and click **Open Anyway** next to *"SemesterSync" was blocked*.
3. Enter your Mac password and click **Open Anyway** again. You only do this once.

On macOS 14 or earlier, right-click SemesterSync in Applications, choose **Open**, then **Open** again. If neither works, run `xattr -dr com.apple.quarantine /Applications/SemesterSync.app` in Terminal.

**Windows:** download `SemesterSync-Setup-….exe` and run it. If Windows shows "Windows protected your PC", choose **More info → Run anyway**.

Updating keeps your courses, settings and sign-in.

## What it does

| Tab | What's in it |
|---|---|
| **Today** | A **focus timer** (15, 25, 50 or 90 minutes, with breaks) for any deliverable or general study; finished time is logged automatically and the countdown stays in the top bar on every tab. Plus a compact view of the day: classes (read from each syllabus's meeting times, editable under **Class times**, skipping holidays and breaks), your top 3 priorities with why, what's due next with a countdown, today's study plan, and overdue or at-risk warnings. |
| **Inbox** | Capture tasks that aren't in a syllabus (homework announced in class, readings, projects, study goals) by typing them in plain English: “Biology paper due Friday, 5 pages”. SemesterSync proposes the title, course, due date and time, type, estimated time, notes and priority, and you check them before saving. Ambiguous dates (“next Tuesday” said on a Monday, “next week”) are offered as choices, never guessed; unknown courses are never invented. Filters for everything, tasks that need attention (no date, no course, new from Quick Add, possible duplicate) and tasks with no course, plus search, editing, completing, deleting with undo, **Move to course** and **Plan today**. |
| **Semester** | Add syllabi as PDFs, text or photos (**Scan photo** reads a printed page with Claude). After each parse, **What we found** lists everything to check before you rely on it: low-confidence items, ambiguous dates like 3/4, a missing year, weights that don't add to 100%, missing items. Fix them in place or jump to the line in the syllabus. The original file is kept with the course. Then every deliverable (searchable and filterable), grading breakdown, workload heatmap and calendar export. |
| **Plan** | Smart deadlines (overdue, today, this week) ranked by priority, with done checkboxes and time logging. An adaptive study planner books work into the hours you have each day and re-plans whenever you finish something, log time or miss a day. Deadlines that won't fit are flagged as at risk, with how many hours short you are. Days with two or more big deadlines are called out, planned work you didn't log yesterday is named and moved forward, you can lock a session to its day, and every priority explains itself (tap **High** to see why). |
| **Grades** | Grade predictor: enter scores and see your current grade, projected final and what you need on the rest for each letter. **Final-exam targets:** the score you need on the final for every letter grade, plus a slider for "if I get X on the final". **Weighted grade calculator:** your average in each grading category (filled in from your scores, or typed in), with your own categories for any course. **GPA:** semester and cumulative GPA, what-if grades, a goal GPA, and a likely semester GPA with a best and worst case. |
| **Study** | Claude makes flashcards, a practice quiz and a study guide from a topic and your notes. Flashcards use spaced repetition (SM-2 style), timed so cards come up again before the exam they're for. **Weak spots:** every flashcard rating and quiz answer is recorded with its topic; topics you keep getting wrong are flagged with the questions you missed, a review is scheduled in the Inbox, and you can practice just that topic or have Claude write new questions aimed at your mistakes. A topic counts as improved only when your answers show it, never just because a study session was finished. |
| **Coach** | Chat with Claude about your semester. It sees your courses, deadlines, grades and plan, and nothing else. |
| **Rooms** | Study rooms: join with a code, see who's there, what they're working on and their focus timers, and chat. Finished focus sessions count as logged time. |
| **Insights** | A **weekly progress report** (hours studied vs. the hours you set aside, by course; deadlines done, late and missed; new scores and how projected grades moved; flashcards reviewed; and next week's deadlines), which you can save as a file or talk through with the coach. **Study history**: every focus session and logged hour, a 14-day chart, weekly totals and your streak, with mistakes easy to delete. Also deadlines done, hours logged, projected GPA, grades and remaining work by course, planned hours vs. available hours for 8 weeks, and a **stress test** that shows what breaks if you lose days or study less. |

**Quick Add** (desktop): press **⌘⇧Space** on a Mac or **Ctrl+Shift+Space** on Windows from any app to open a small Quick Add window, type a task, check it and save. It works while SemesterSync is hidden in the menu bar or tray. Change or turn off the shortcut in **Settings**; shortcuts the system uses, and ones another app already holds, are refused with an explanation. **File → Quick Add Task** and the menu-bar/tray menu open the same window.

**Reminders** (Today tab): desktop notifications before each deadline at the times you pick (1 week, 3 days, 1 day, 6 hours, 2 hours, 1 hour), a morning summary of your day, a daily nudge about overdue work, warnings when something high priority is due within two days, quiet hours (nothing arrives; what's still ahead comes after), a daily **study nudge** if you haven't started today's planned work, the **weekly report** on the day and time you pick, a notification when a focus session ends, **muting** a course, and snooze for one deliverable or pause everything for an hour or until tomorrow. Settings follow your account to every computer; what was already sent is tracked per computer so nothing repeats.

**Menu bar / system tray:** SemesterSync puts an icon in the Mac menu bar (with how many things are due today) or the Windows system tray. Its menu lists today's remaining classes, your top priorities and what's due next. Click one to open it, or pause reminders from there. Closing the window keeps the app running there so reminders keep coming (turn that off in Settings). Real home-screen or Notification Center widgets need native WidgetKit/Windows code that Electron apps can't provide, so the tray is the widget.

**Your data** (the database icon, top right) has backups, restore, safety copies, sync status, theme and Start over. See [Backups and safety](#backups-and-safety).

The first launch opens a short welcome guide: start with your own syllabus, explore sample courses or restore a backup; what works offline and what uses Claude; accounts (optional); and your study hours. **Help → Welcome Guide** shows it again.

Claude features (photo scanning, study sets, coach) need a Claude API key in Settings. Study rooms use SemesterSync's own server and don't need an account; only a name, current task, timer and chat are shared, and nothing is stored.

## Run it while developing

```bash
npm install
npm start
```

Set `SEMESTERSYNC_DATA_DIR=/some/folder` to run on a separate profile without touching your saved courses.

## Tests

```bash
npm test                # the app, with a fake Claude API and a fake account server
npm run test:backend    # the account server's tests (needs PostgreSQL 17; see backend/README.md)
npm run test:accounts   # the real app against the real account server on a throwaway database
```

```bash
npm run test:sync       # two app windows syncing through the real account server
```

`npm test` runs the real app on a throwaway profile with a fake Claude API and a fake account server (a duplicate-function check, 23 parser checks, 16 merge checks, then 198 app checks, about 3 minutes). Nothing touches your data or your Claude key. It covers first launch, the Today view and reminders (intervals, morning summary, overdue and high-priority warnings, quiet hours, pausing, no repeats, the tray summary), syllabus review, calendar export, backup and restore, damaged data, upgrading data from earlier versions, copying an old account's courses to the computer, the planner, search and shortcuts, and cloud sync: asking first, per-course choices, changes flowing both ways, combining edits, each **Needs your choice** button, offline, removing courses and removing data from the account. The GitHub workflow runs it on macOS and Windows for every push and before any release.

`npm run test:backend` starts a temporary PostgreSQL cluster in a temp folder and runs the server's tests (38 checks: sign-up codes, sign-in, sessions, password reset, rate limits, sync versions and conflicts, deletion markers, limits, one person never reaching another's account or documents, nothing secret in logs or responses). `npm run test:accounts` starts the server the same way and drives the app's real account dialog against it (37 checks); `npm run test:sync` has two app windows sync through it, including both saving at the same moment (21 checks).

## Backups and safety

- **Backup file:** **Your data → Export backup** (or `⌘⇧B` / `Ctrl+Shift+B`) saves one `.json` file with every course, score, study set and setting. **Restore from a file** asks whether to replace what you have or add the courses you don't have yet.
- **Daily backups:** the app also writes one to its `Backups` folder each day you use it and keeps the last 30 (**Your data → Open Backups folder**).
- **Safety copies:** taken automatically before anything that removes data (removing a course, clearing samples, marking past deadlines done, deleting a study set, restoring, Start over) and when the same thing was edited on two computers. Most of those also show an **Undo** button.
- **Upgrading:** the first time a version with local-first storage starts, it saves the exact data it finds to a `SemesterSync-before-local-first-….json` file in the Backups folder before writing anything. That file can be restored from **Your data** like any backup.
- **Damaged data:** saved courses are read one at a time, so one damaged entry is skipped instead of losing the semester. The damaged data is kept and the app says what happened.
- **Spreadsheet:** **Your data → Deliverables as a spreadsheet** exports every deliverable as `.csv`.

## Claude parsing

Choose **Settings** (the gear in the top bar, or `⌘,` / `Ctrl+,`) and paste a Claude API key from the [Claude Console](https://platform.claude.com/settings/keys). The key is encrypted with the system keychain (`safeStorage`) and stored in the app's data folder. You can also set `ANTHROPIC_API_KEY` in your environment before `npm start`.

Extraction runs in the main process (`src/main.js`) with the Anthropic SDK:

- Model `claude-opus-5-5` at `medium` effort, streamed so the page can show progress
- Structured output (`output_config.format` with a JSON schema), so the reply always parses
- `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): if a request is declined, the API retries it on Anthropic's recommended fallback model

Without a key the app still works. It uses the built-in local parser.

## Accounts

Accounts are optional. SemesterSync opens straight into the app, every feature works without an account, and courses are always saved on the computer. An account is an email and password on SemesterSync's own server (`backend/`); no outside sign-in service is used.

- **Create account:** email and password (8 to 128 characters), and you're signed in. Nothing is emailed. An email that already has an account is told to sign in instead.
- **Sign in / Sign out.** Signing out keeps the courses on the computer. On a shared computer, tick **Also remove my courses, settings and backups from this computer**.
- **Forgot password?** emails a 6-digit code (valid 15 minutes, 5 tries; only the newest works); type it with a new password. Every computer signed in to the account is signed out. This is the only email the server sends. Because sign-up doesn't check the email, someone could make an account with an address that isn't theirs; the address's owner can always take it over with **Forgot password?**.
- **Your account:** change password (signs out the other computers), see **Signed-in computers** and sign any of them out, and **Delete account** (asks for the password; deletes the account at once, and leaves the courses on the computer).
- **Where the session lives:** the main process (`src/account.js`) talks to the API; the page never sees the session token. The token is encrypted with the system keychain (`safeStorage`) in `account.bin` in the app's data folder; without a keychain it's kept in memory until the app quits.
- **Server address:** `SEMESTERSYNC_API_URL`, or `apiUrl` in `src/config.json`. Installed builds only accept `https://` addresses; `http://localhost` works only when running from source. While it's empty, the account dialog says accounts aren't available and everything else works as usual.

To run the server locally, see [`backend/README.md`](backend/README.md).

### Cloud sync (optional)

- **Nothing is uploaded until you agree.** After signing in (or from **Your data → Turn on cloud sync…**), a checklist shows every course on the computer, plus **Settings, Inbox and study history**, and what's already in the account. Untick anything you want to keep only on this computer. **Not now** uploads nothing. A backup file (`SemesterSync-before-first-sync-….json`) is saved before the first sync.
- **This computer stays the main copy.** Everything saves here first and works offline; the status says **Offline** and syncs by itself when the connection is back.
- **Each course has a switch** next to **Remove course**: **Synced** or **Only on this computer**. Turning it off asks whether to remove the course from the account (other computers keep a safety copy) or leave the account's copy as it is. New courses sync automatically while sync is on.
- **When two computers change the same course,** the changes are combined deliverable by deliverable and field by field: a score added on one and a due date moved on the other both stay. Settings and study history are always combined. Only when the same thing was changed differently on both (or deleted on one and edited on the other) does it go to **Your data → Needs your choice**, which shows both versions and where the other came from: **Keep this computer's**, **Keep the other**, or **Keep both** (the other becomes a second course). Until then this computer keeps its own version, everything else keeps syncing, and the version not kept goes to Safety copies.
- **Two computers saving at the same moment can't overwrite each other:** each change says which version it was based on, and the server refuses one that didn't see the latest copy. The app then combines and tries again.
- **Removing courses:** a course removed on one computer is removed on the others, which keep a safety copy first.
- **Turn off cloud sync** (in **Your data**) keeps everything on the computer. **Remove my data from the account…** (password required) deletes everything synced from the server and turns sync off on every computer; the account stays.
- **Limits:** 25 MB and 300 documents per account, 1 MB per course. Original syllabus files (PDFs) aren't synced.
- **Not encrypted end to end:** the data is encrypted in transit (HTTPS) and on the server's disk, but the server could read it. That keeps password reset from losing data; end-to-end encryption can be added later.

**Old accounts (Supabase, versions 1.0 to 1.4).** The first time this version starts on a computer that was signed in to an old account, it copies that account's courses to the computer:

- A raw copy of the old account goes to `Backups/SemesterSync-old-account-copy-….json` first. It can be restored from **Your data** like any backup.
- Edits made on the computer that never reached the account are kept. Where the account has a newer copy the computer hadn't changed, the account's copy is used. If a course changed in both places, the computer's copy is kept and the other goes to **Your data → Safety copies**.
- Courses that were only on the computer stay.
- Then the old sign-in is removed (`session.bin` is deleted) and a note explains what happened.
- If the old account can't be reached and the computer has no copy of it, nothing changes and it tries again on the next start.

This copy is the only thing still using Supabase. It stays until people have had time to update (see `docs/stage5-release-plan.md`); then `src/legacy.js` and the Supabase project go.

## Build installers

```bash
npm run dist:mac   # dist/SemesterSync-1.5.0-universal.dmg (Intel + Apple silicon)
npm run dist:win   # dist/SemesterSync-Setup-1.5.0.exe (x64 + arm64)
scripts/verify-installer.sh   # installs/mounts the build, starts it on a throwaway profile, checks signing
```

Build each platform on its own OS. The GitHub Actions workflow in `.github/workflows/build.yml` runs the tests, then on a tag like `v1.2.0` builds both installers, installs and starts each one to check it works, and posts them with a `SHA256SUMS.txt` on the [Releases](https://github.com/jbutler0831/semestersync/releases) page.

### Signing the installers

Unsigned builds work, but each OS warns people the first time (see [Install](#install) for how to open them). The workflow signs automatically once these **repository secrets** exist (GitHub → Settings → Secrets and variables → Actions):

| Secret | Where it comes from |
|---|---|
| `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` | Apple Developer Program ($99/year): create a **Developer ID Application** certificate, export it from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Your Apple ID, an app-specific password from [account.apple.com](https://account.apple.com), and your Team ID from the developer portal. With these, builds are notarized so Gatekeeper opens them without a warning. |
| `WIN_CERT_P12_BASE64`, `WIN_CERT_PASSWORD` | A Windows code-signing certificate (`.pfx`), base64-encoded the same way |

After adding them, set the repository variable `REQUIRE_SIGNED` to `1` so a release fails instead of shipping an unsigned build.

## Where things live

| Path | What it does |
|---|---|
| `src/main.js` | Window, menus, Claude API calls, settings, saving files, daily backups, original syllabus files |
| `src/account.js` | Accounts and sync requests to SemesterSync's own API; keeps the session token |
| `src/rooms.js` | Study rooms: one WebSocket per room to SemesterSync's own API |
| `src/legacy.js` | The one-time copy of old Supabase accounts |
| `src/config.json` | The SemesterSync server address (`apiUrl`), and the old Supabase project (only for copying old accounts) |
| `backend/` | The account server (FastAPI + PostgreSQL); see `backend/README.md` |
| `supabase/schema.sql` | The old account database (only for the old accounts still being copied) |
| `src/preload.js` | The only bridge between the page and the main process (context isolation on, no Node in the page) |
| `src/renderer/index.html`, `app.js` | The app UI |
| `src/renderer/bridge.js` | Connects the UI's Claude calls to the main process |
| `src/renderer/desktop.js` | Settings, account and cloud sync dialogs, menu shortcuts |
| `src/renderer/cloudsync.js` | Cloud sync with the account server: versions, Needs your choice, the per-course switch |
| `src/renderer/merge.js` | Combines two edited copies of a course, study set or settings (`test/merge.test.js`) |
| `src/assets/` | Menu-bar and tray icons |
| `src/renderer/taskparse.js` | Reads a task typed in plain English (runs on the device; no API) |
| `src/renderer/quickadd.html`, `quickadd.js` | The Quick Add window |
| `test/taskparse.test.js` | Parser unit tests (`npm run test:parse`) |
| `test/e2e.js`, `test/fake-claude.js` | The regression tests (`npm test` runs both) |
| `test/accounts.e2e.js`, `test/sync.e2e.js` | The app against the real account server (`npm run test:accounts`, `npm run test:sync`) |
| `scripts/verify-installer.sh` | Checks a built installer installs and starts |
| `build/icon.png` | App icon (electron-builder converts it to .icns and .ico) |

## Keyboard shortcuts

| Action | Mac | Windows |
|---|---|---|
| New course | ⌘N | Ctrl+N |
| Open syllabus file | ⌘O | Ctrl+O |
| Export to calendar app | ⌘E | Ctrl+E |
| Quick Add from any app | ⌘⇧Space (change in Settings) | Ctrl+Shift+Space |
| Add a task in the Inbox | N | N |
| Search everything | ⌘K or / | Ctrl+K or / |
| Switch tabs (Today, Inbox, …) | ⌘1 – ⌘9 | Ctrl+1 – Ctrl+9 |
| Export a backup | ⇧⌘B | Ctrl+Shift+B |
| Show all shortcuts | ? | ? |
| Parse while editing | ⌘↵ | Ctrl+Enter |
| Light / dark | ⇧⌘L | Ctrl+Shift+L |
| Settings | ⌘, | Ctrl+, |

## How Inbox tasks are stored

A captured task is an ordinary deliverable with three extra fields (`src: "inbox"`, an optional `prio`, `created`). With a course, it lives in that course; without one, it lives in a built-in **Inbox** course (`course-inbox`) that is saved, synced, backed up and restored like any course but never shown as one. Its items are part of `allItems()`, so Today, Plan, reminders, calendar export, insights, search and the coach include them with no separate code. Tasks without a due date wait in that Inbox course's `drafts` until they get one. Deleting a course moves the tasks you added back to the Inbox instead of deleting them.

Tasks from the Quick Add window are written to `quick-queue.json` in the app's data folder first and removed only after the page has saved them, so a task survives the app closing at the wrong moment.

## Calendar

**Add to calendar** saves an `.ics` file and opens it in Apple Calendar or Outlook to import (Google Calendar: import it at calendar.google.com → Settings → Import). Each event keeps the same ID between exports, and after the first export only new and changed events are exported, so nothing is added twice. A calendar file can't delete events, so the app lists the ones to remove yourself. Each deadline also has its own Google Calendar link in the table.

There's no live two-way Google Calendar sync. That needs a Google Cloud OAuth app that Google has reviewed for calendar access, which is more than this release needs. The earlier simulated "Connect" button is gone.
