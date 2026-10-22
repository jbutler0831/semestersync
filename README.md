# SemesterSync (desktop)

A Mac and Windows app that turns course syllabi into a semester plan: every dated deliverable, each course's grading breakdown, a workload heatmap that shows where courses collide, and calendar export.

## Run it while developing

```bash
npm install
npm start
```

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
- The first time someone creates an account or signs in to an empty account, the courses already on that computer move into it.
- Signing out returns the app to the courses saved on that computer.
- **Forgot password** emails a code; people type it into the app with a new password.
- **Continue with Google** opens Google in the browser and finishes sign-in in the app (PKCE, so the login code is useless to anyone else).

## Build installers

```bash
npm run dist:mac   # dist/SemesterSync-1.0.0-universal.dmg (Intel + Apple silicon)
npm run dist:win   # dist/SemesterSync Setup 1.0.0.exe (x64 + arm64)
```

Build each platform on its own OS. The GitHub Actions workflow in `.github/workflows/build.yml` builds both whenever you push a tag like `v1.0.0` and attaches the installers to the run.

### Signing (before you share it widely)

Unsigned builds work, but each OS warns people:

- **macOS:** Gatekeeper blocks unsigned apps. Testers can right-click the app, choose **Open**, then confirm. To remove the warning, join the Apple Developer Program ($99/year), then set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` so electron-builder signs and notarizes the app.
- **Windows:** SmartScreen shows "Windows protected your PC". Testers choose **More info → Run anyway**. A code-signing certificate removes it.

## Where things live

| Path | What it does |
|---|---|
| `src/main.js` | Window, menus, Claude API calls, settings, .ics save dialog |
| `src/cloud.js` | Accounts and cloud sync (Supabase) |
| `src/config.json` | Your Supabase project URL and anon key |
| `supabase/schema.sql` | Database table and security rules to run once |
| `src/preload.js` | The only bridge between the page and the main process (context isolation on, no Node in the page) |
| `src/renderer/index.html`, `app.js` | The app UI |
| `src/renderer/bridge.js` | Connects the UI's Claude calls to the main process |
| `src/renderer/desktop.js` | Settings dialog, "Open in Calendar app", menu shortcuts, deadline notifications |
| `build/icon.png` | App icon (electron-builder converts it to .icns and .ico) |

## Keyboard shortcuts

| Action | Mac | Windows |
|---|---|---|
| New course | ⌘N | Ctrl+N |
| Open syllabus file | ⌘O | Ctrl+O |
| Export to calendar app | ⌘E | Ctrl+E |
| Parse while editing | ⌘↵ | Ctrl+Enter |
| Light / dark | ⇧⌘L | Ctrl+Shift+L |
| Settings | ⌘, | Ctrl+, |

## What's real and what isn't yet

- **Real:** Claude parsing, accounts with cloud sync (once Supabase is set up), saving on this computer, deadline notifications, and **Open in Calendar app**, which saves an `.ics` file and hands it to Apple Calendar or Outlook to import.
- **Simulated:** the Google account connection and push. Making it real needs a Google Cloud OAuth client and the Calendar API.
