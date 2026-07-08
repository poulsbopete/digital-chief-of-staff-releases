#!/usr/bin/env bash
# Bootstrap vendor cache: public install-scripts mirror, then optional private source repo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/../config/github-repos.defaults.sh" ]]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/../config/github-repos.defaults.sh"
fi

SOURCE_REPO="${DCOS_GITHUB_REPO:-elastic/digital-chief-of-staff}"
MIRROR_REPO="${DCOS_SCRIPTS_MIRROR_REPO:-poulsbopete/digital-chief-of-staff-releases}"
REF="${DCOS_GITHUB_REF:-main}"

_fetch_from() {
  local repo="$1" prefix="$2"
  local base="https://raw.githubusercontent.com/${repo}/${REF}/${prefix}scripts/fetch-install-assets.sh"
  DCOS_GITHUB_REPO="$repo" DCOS_GITHUB_REF="$REF" DCOS_RAW_PREFIX="$prefix" \
    curl -fsSL "$base" | bash
}

# Prefer public mirror (elastic source is private for most users).
if _fetch_from "$MIRROR_REPO" "install-scripts/" 2>/dev/null; then
  exit 0
fi

if _fetch_from "$SOURCE_REPO" "" 2>/dev/null; then
  exit 0
fi

echo "Could not download DCOS installer scripts from ${MIRROR_REPO} or ${SOURCE_REPO}" >&2
echo "Install via DMG: https://github.com/${MIRROR_REPO}/releases/latest" >&2
exit 1
