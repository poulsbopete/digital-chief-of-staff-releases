#!/usr/bin/env bash
# Verify a DCOS macOS DMG is signed, notarized, and stapled (Gatekeeper-ready).
# Usage: ./scripts/verify-macos-installer.sh [path/to/Installer.dmg]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DMG="${1:-${ROOT}/dist/Digital-Chief-of-Staff-Installer.dmg}"
APP_NAME="Install Digital Chief of Staff.app"

log() { printf '→ %s\n' "$*"; }
ok()  { printf '✓ %s\n' "$*"; }
fail(){ printf '✗ %s\n' "$*" >&2; exit 1; }

[[ -f "$DMG" ]] || fail "DMG not found: $DMG"

log "Staple ticket…"
if xcrun stapler validate "$DMG" 2>&1; then
  ok "Notarization ticket stapled to DMG"
else
  fail "No stapled notarization ticket — users will see 'Apple could not verify'"
fi

MOUNT="$(hdiutil attach "$DMG" -nobrowse -readonly | awk -F'\t' '/\/Volumes\// {print $3; exit}')"
[[ -z "$MOUNT" ]] && MOUNT="$(hdiutil attach "$DMG" -nobrowse -readonly | tail -1 | sed 's/^[[:space:]]*[^[:space:]]*[[:space:]]*[^[:space:]]*[[:space:]]*//')"
[[ -d "$MOUNT/$APP_NAME" ]] || fail "Missing app in DMG: $APP_NAME"

log "Code signature…"
codesign --verify --deep --strict "$MOUNT/$APP_NAME" || fail "Code signature invalid"
ok "Developer ID signature valid"

log "Gatekeeper…"
if spctl -a -v "$MOUNT/$APP_NAME" 2>&1 | tee /dev/stderr | grep -q "accepted"; then
  ok "Gatekeeper accepts app (Notarized Developer ID)"
else
  hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  fail "Gatekeeper rejected app"
fi

hdiutil detach "$MOUNT" -quiet 2>/dev/null || hdiutil detach "$MOUNT" -force -quiet

echo ""
ok "Installer is verified — safe to ship on GitHub Releases"
