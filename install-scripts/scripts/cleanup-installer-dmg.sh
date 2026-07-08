#!/usr/bin/env bash
# After a successful DMG install, unmount and delete the installer disk image.
# Only runs when install.sh was launched from a mounted .dmg (/Volumes/...).
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-${DCOS_ROOT_DIR:-}}"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }

[[ "$(uname -s)" == Darwin ]] || exit 0
[[ -n "$ROOT_DIR" && "$ROOT_DIR" == /Volumes/* ]] || exit 0

mount="/Volumes/${ROOT_DIR#*/Volumes/}"
mount="${mount%%/*}"

find_dmg_path() {
  hdiutil info | awk -v m="$mount" '
    /^image-path:/ { path=$0; sub(/^image-path:[[:space:]]*/, "", path) }
    index($0, m) { if (path != "") { print path; exit } }
  '
}

dmg="$(find_dmg_path || true)"

log "Cleaning up installer DMG…"
if hdiutil detach "$mount" -quiet 2>/dev/null; then
  ok "Unmounted ${mount}"
else
  hdiutil detach "$mount" -force -quiet 2>/dev/null || true
fi

if [[ -n "$dmg" && -f "$dmg" ]]; then
  rm -f "$dmg"
  ok "Deleted ${dmg}"
elif [[ -n "$dmg" ]]; then
  log "DMG already moved or removed: ${dmg}"
fi
