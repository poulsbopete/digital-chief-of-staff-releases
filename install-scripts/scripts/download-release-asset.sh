#!/usr/bin/env bash
# Download a release asset from the public releases repo by filename pattern.
# Usage: download-release-asset.sh meddpicc-coach.skill /path/to/dest.skill
set -euo pipefail

PATTERN="${1:?filename pattern (e.g. meddpicc-coach.skill)}"
DEST="${2:?destination path}"
RELEASES_REPO="${DCOS_RELEASES_REPO:-poulsbopete/digital-chief-of-staff-releases}"
API="https://api.github.com/repos/${RELEASES_REPO}/releases/latest"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}

need_cmd curl
need_cmd mkdir

json="$(curl -fsSL "$API")"
url="$(printf '%s' "$json" | grep -Eo "\"browser_download_url\"[[:space:]]*:[[:space:]]*\"[^\"]*${PATTERN}[^\"]*\"" \
  | head -1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"

if [[ -z "$url" ]]; then
  echo "No release asset matching *${PATTERN}* in ${RELEASES_REPO}" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
curl -fsSL "$url" -o "$DEST"
echo "$DEST"
