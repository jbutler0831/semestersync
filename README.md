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
| **Semester** | Add syllabi as PDFs, text or photos (**Scan photo** reads a printed page with Claude). After each parse, **What we found** lists everything to check before you rely on it: low-confidence items, ambiguous dates like 3/4, a missing year, weights that don't add to 100%, missing items. Fix them in place or jump to the line in the syllabus. The original file is kept with the course. Then every deliverable (searchable and filterable), grading breakdown, workload heatmap and calendar export. |
| **Plan** | Smart deadlines (overdue, today, this week) ranked by priority, with done checkboxes and time logging. An adaptive study planner books work into the hours you have each day and re-plans whenever you finish something, log time or miss a day. Deadlines that won't fit are flagged as at risk, with how many hours short you are. Days with two or more big deadlines are called out, planned work you didn't log yesterday is named and moved forward, you can lock a session to its day, and every priority explains itself (tap **High** to see why). |
| **Grades** | Grade predictor: enter scores and see your current grade, projected final and what you need on the rest for each letter. **Final-exam targets:** the score you need on the final for every letter grade, plus a slider for "if I get X on the final". **Weighted grade calculator:** your average in each grading category (filled in from your scores, or typed in), with your own categories for any course. **GPA:** semester and cumulative GPA, what-if grades, a goal GPA, and a likely semester GPA with a best and worst case. |
| **Study** | Claude makes flashcards, a practice quiz and a study guide from a topic and your notes. Flashcards use spaced repetition (SM-2 style), timed so cards come up again before the exam they're for. |
| **Coach** | Chat with Claude about your semester. It sees your courses, deadlines, grades and plan, and nothing else. |
| **Rooms** | Study rooms: join with a code, see who's there, what they're working on and their focus timers, and chat. Finished focus sessions count as logged time. |
| **Insights** | A **weekly progress report** (hours studied vs. the hours you set aside, by course; deadlines done, late and missed; new scores and how projected grades moved; flashcards reviewed; and next week's deadlines), which you can save as a file or talk through with the coach. **Study history**: every focus session and logged hour, a 14-day chart, weekly totals and your streak, with mistakes easy to delete. Also deadlines done, hours logged, projected GPA, grades and remaining work by course, planned hours vs. available hours for 8 weeks, and a **stress test** that shows what breaks if you lose days or study less. |

**Reminders** (Today tab): desktop notifications before each deadline at the times you pick (1 week, 3 days, 1 day, 6 hours, 2 hours, 1 hour), a morning summary of your day, a daily nudge about overdue work, warnings when something high priority is due within two days, quiet hours (nothing arrives; what's still ahead comes after), a daily **study nudge** if you haven't started today's planned work, the **weekly report** on the day and time you pick, a notification when a focus session ends, **muting** a course, and snooze for one deliverable or pause everything for an hour or until tomorrow. Settings follow your account to every computer; what was already sent is tracked per computer so nothing repeats.

**Menu bar / system tray:** SemesterSync puts an icon in the Mac menu bar (with how many things are due today) or the Windows system tray. Its menu lists today's remaining classes, your top priorities and what's due next. Click one to open it, or pause reminders from there. Closing the window keeps the app running there so reminders keep coming (turn that off in Settings). Real home-screen or Notification Center widgets need native WidgetKit/Windows code that Electron apps can't provide, so the tray is the widget.

**Your data** (the database icon, top right) has backups, restore, safety copies, sync status, theme and Start over. See [Backups and safety](#backups-and-safety).

The first launch opens a short welcome guide: start with your own syllabus, explore sample courses or restore a backup; what works offline and what uses Claude; accounts (optional); and your study hours. **Help → Welcome Guide** shows it again.

Claude features (photo scanning, study sets, coach) need a Claude API key in Settings. Study rooms use Supabase Realtime (on by default in new projects); only a name, current task and timer are shared, and nothing is stored.

## Run it while developing

```bash
npm install
npm start
```

Set `SEMESTERSYNC_DATA_DIR=/some/folder` to run on a separate profile without touching your saved courses.

## Tests

```bash
npm test
```

Runs the real app on a throwaway profile with a fake Claude API and a fake account server (94 checks, about 2 minutes). Nothing touches your data, your Claude key or Supabase. It covers first launch, the Today view and reminders (intervals, morning summary, overdue and high-priority warnings, quiet hours, pausing, no repeats, the tray summary), syllabus review, calendar export, backup and restore, damaged data, the planner, search and shortcuts, and sync between two computers: changes flowing both ways, the same course edited on both, working offline, deleting, signing out, and signing into an account that already has courses. The GitHub workflow runs it on macOS and Windows for every push and before any release.

## Backups and safety

- **Backup file:** **Your data → Export backup** (or `⌘⇧B` / `Ctrl+Shift+B`) saves one `.json` file with every course, score, study set and setting. **Restore from a file** asks whether to replace what you have or add the courses you don't have yet.
- **Daily backups:** the app also writes one to its `Backups` folder each day you use it and keeps the last 30 (**Your data → Open Backups folder**).
- **Safety copies:** taken automatically before anything that removes data (removing a course, clearing samples, marking past deadlines done, deleting a study set, restoring, Start over) and when the same thing was edited on two computers. Most of those also show an **Undo** button.
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

People can create an account (email + password) so their courses sync to that account and follow them to any computer. Accounts use [Supabase](https://supabase.com) (free tier is plenty). Until you set it up, the app works without accounts and saves on each computer.

**One-time setup (about 5 minutes):**

1. Create a free project at [supabase.com](https://supabase.com).
2. In the dashboard, open **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql) and choose **Run**. This creates the `user_docs` table and the row-level security rules that let each person read and write only their own rows.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key into `src/config.json`:
   ```json
   { "supabaseUrl": "https://YOUR-PROJECT.supabase.co", "supabaseAnonKey": "eyJ…" }
   ```
   The anon key is meant to ship inside apps; the security rules are what protect the data. Never put the `service_role` key in the app.
4. Optional: in **Authentication → Sign In / Providers → Email**, turn off **Confirm email** while you're testing. With it on, new users must click the link in their inbox before signing in.
5. `npm start`, choose **Sign in** in the top bar, then **Create account**.

**Forgot password** (needed once): the app has people type a code from the reset email instead of clicking a link. In **Authentication → Emails → Reset Password**, add the code to the template, for example:
```html
<h2>Reset your SemesterSync password</h2>
<p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
<p>If you didn't ask for this, you can ignore this email.</p>
```

**Sign in with Google:**

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, set up the **OAuth consent screen** (External, app name "SemesterSync"), then **Credentials → Create credentials → OAuth client ID → Web application**.
2. Under **Authorized redirect URIs**, add `https://YOUR-PROJECT.supabase.co/auth/v1/callback`. Copy the client ID and secret.
3. In Supabase, open **Authentication → Sign In / Providers → Google**, turn it on, and paste the client ID and secret.
4. In Supabase, open **Authentication → URL Configuration → Redirect URLs** and add `http://127.0.0.1:53682/auth/callback`. After someone signs in with Google in their browser, Google sends them to this address, where the app is listening for a few minutes.
5. While the consent screen is in **Testing**, only Google accounts you list as test users can sign in. Publish it to let anyone sign in.

How it works:

- Sign-in happens in the main process (`src/cloud.js`). The session token is encrypted with the system keychain and kept in the app's data folder, so people stay signed in.
- The first time someone creates an account or signs in to an empty account, the courses already on that computer move into it. Signing into an account that already has courses asks first: **Add them** (this computer's own courses join the account; sample courses never do) or **Keep separate**.
- Each course, study set and the settings are separate documents. Every save first reads the account: a document only another computer changed is taken as is; when both changed it, the newer edit wins and the other copy goes to **Your data → Safety copies**. Open windows pick up changes from other computers when you switch back to them and every couple of minutes.
- Offline, changes save on the computer and the status says **Offline**. The app retries on its own (5 s, 15 s, 30 s, then every minute or two) and syncs when the connection is back, even after a restart.
- Signing out removes the account's copy from that computer and returns the app to the courses saved there before.
- **Forgot password** emails a code; people type it into the app with a new password.
- **Continue with Google** opens Google in the browser and finishes sign-in in the app (PKCE, so the login code is useless to anyone else).

## Build installers

```bash
npm run dist:mac   # dist/SemesterSync-1.3.0-universal.dmg (Intel + Apple silicon)
npm run dist:win   # dist/SemesterSync-Setup-1.3.0.exe (x64 + arm64)
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
| `src/cloud.js` | Accounts and cloud sync (Supabase) |
| `src/config.json` | Your Supabase project URL and anon key |
| `supabase/schema.sql` | Database table and security rules to run once |
| `src/preload.js` | The only bridge between the page and the main process (context isolation on, no Node in the page) |
| `src/renderer/index.html`, `app.js` | The app UI |
| `src/renderer/bridge.js` | Connects the UI's Claude calls to the main process |
| `src/renderer/desktop.js` | Settings and account dialogs, menu shortcuts |
| `src/assets/` | Menu-bar and tray icons |
| `test/e2e.js`, `test/fake-claude.js` | The regression tests (`npm test`) |
| `scripts/verify-installer.sh` | Checks a built installer installs and starts |
| `build/icon.png` | App icon (electron-builder converts it to .icns and .ico) |

## Keyboard shortcuts

| Action | Mac | Windows |
|---|---|---|
| New course | ⌘N | Ctrl+N |
| Open syllabus file | ⌘O | Ctrl+O |
| Export to calendar app | ⌘E | Ctrl+E |
| Search everything | ⌘K or / | Ctrl+K or / |
| Switch tabs (Today first) | ⌘1 – ⌘8 | Ctrl+1 – Ctrl+8 |
| Export a backup | ⇧⌘B | Ctrl+Shift+B |
| Show all shortcuts | ? | ? |
| Parse while editing | ⌘↵ | Ctrl+Enter |
| Light / dark | ⇧⌘L | Ctrl+Shift+L |
| Settings | ⌘, | Ctrl+, |

## Calendar

**Add to calendar** saves an `.ics` file and opens it in Apple Calendar or Outlook to import (Google Calendar: import it at calendar.google.com → Settings → Import). Each event keeps the same ID between exports, and after the first export only new and changed events are exported, so nothing is added twice. A calendar file can't delete events, so the app lists the ones to remove yourself. Each deadline also has its own Google Calendar link in the table.

There's no live two-way Google Calendar sync. That needs a Google Cloud OAuth app that Google has reviewed for calendar access, which is more than this release needs. The earlier simulated "Connect" button is gone.
