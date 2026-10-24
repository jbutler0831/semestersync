#!/usr/bin/env bash
# Checks a built installer the way a student would get it: installs or mounts it, starts the app on a
# throwaway profile, and confirms the page loads with no errors. Also reports signing and notarization.
#   scripts/verify-installer.sh            # checks whatever is in dist/
# Exits non-zero if the app doesn't start cleanly, or if REQUIRE_SIGNED=1 and it isn't signed.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
WORK=$(mktemp -d)
REPORT="$WORK/smoke.json"
export SEMESTERSYNC_DATA_DIR="$WORK/profile" SEMESTERSYNC_SMOKE="$REPORT"
fail() { echo "FAIL: $*"; exit 1; }

case "$(uname -s)" in
  Darwin)
    DMG=$(ls dist/SemesterSync-"$VERSION"-*.dmg | head -1) || fail "no DMG for $VERSION in dist/"
    echo "Checking $DMG"
    hdiutil verify "$DMG" >/dev/null || fail "DMG checksum is bad"
    MNT="$WORK/mnt"; mkdir -p "$MNT"
    hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MNT" >/dev/null
    trap 'hdiutil detach "$MNT" -quiet || true' EXIT
    APP="$MNT/SemesterSync.app"
    [ -d "$APP" ] || fail "SemesterSync.app isn't in the DMG"
    PLIST_V=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")
    [ "$PLIST_V" = "$VERSION" ] || fail "app says version $PLIST_V, expected $VERSION"
    lipo -archs "$APP/Contents/MacOS/SemesterSync" | grep -q x86_64 && lipo -archs "$APP/Contents/MacOS/SemesterSync" | grep -q arm64 || fail "app isn't universal (Intel + Apple silicon)"
    if codesign --verify --deep --strict "$APP" 2>/dev/null && codesign -dv "$APP" 2>&1 | grep -q 'Authority=Developer ID'; then
      echo "Signed: $(codesign -dv "$APP" 2>&1 | grep -m1 Authority=)"
      if spctl --assess --type execute "$APP" 2>/dev/null; then echo "Notarized: Gatekeeper accepts it"; else echo "Not notarized: Gatekeeper will warn"; [ "${REQUIRE_SIGNED:-0}" = 1 ] && fail "not notarized"; fi
    else
      echo "Not signed with a Developer ID (people need System Settings → Privacy & Security → Open Anyway the first time)"
      [ "${REQUIRE_SIGNED:-0}" = 1 ] && fail "not signed"
    fi
    "$APP/Contents/MacOS/SemesterSync" >/dev/null 2>&1 &
    ;;
  MINGW*|MSYS*|CYGWIN*)
    EXE=$(ls dist/SemesterSync-Setup-"$VERSION".exe) || fail "no installer for $VERSION in dist/"
    echo "Checking $EXE"
    DEST=$(cygpath -w "$WORK/install")
    powershell -NoProfile -Command "\$s = Get-AuthenticodeSignature '$(cygpath -w "$EXE")'; Write-Output ('Signature: ' + \$s.Status)" | tee "$WORK/sig.txt"
    if ! grep -q 'Signature: Valid' "$WORK/sig.txt"; then echo "Not signed (SmartScreen will warn)"; [ "${REQUIRE_SIGNED:-0}" = 1 ] && fail "not signed"; fi
    # NSIS: /S is silent, /D must come last and has no quotes.
    powershell -NoProfile -Command "Start-Process -Wait -FilePath '$(cygpath -w "$EXE")' -ArgumentList '/S','/D=$DEST'"
    APP="$WORK/install/SemesterSync.exe"
    [ -f "$APP" ] || fail "installer didn't put SemesterSync.exe in place"
    "$APP" >/dev/null 2>&1 &
    ;;
  *) fail "run this on macOS or Windows" ;;
esac

for _ in $(seq 1 60); do [ -s "$REPORT" ] && break; sleep 1; done
[ -s "$REPORT" ] || fail "the app didn't start within a minute"
cat "$REPORT"; echo
node -e "const r = require(process.argv[1]); if (!r.ok) process.exit(1); if (r.version !== process.argv[2]) { console.error('version mismatch'); process.exit(1); }" "$REPORT" "$VERSION" || fail "the app started with errors"
echo "OK: SemesterSync $VERSION installs and starts cleanly"
