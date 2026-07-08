#!/usr/bin/env bash
# Copy install-time scripts into releases-public/install-scripts/ for public curl installs.
# The elastic source repo is private; field users fetch from digital-chief-of-staff-releases.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${ROOT}/releases-public/install-scripts"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }

rm -rf "${DEST}"
mkdir -p "${DEST}"

log "Syncing install-scripts mirror → releases-public/install-scripts/"

rsync -a \
  --exclude '.git' \
  "${ROOT}/scripts/" "${DEST}/scripts/"

rsync -a \
  "${ROOT}/lib/" "${DEST}/lib/"

mkdir -p "${DEST}/config"
cp -f "${ROOT}/config/github-repos.defaults.sh" "${DEST}/config/"
cp -f "${ROOT}/config/connectors.yaml.example" "${DEST}/config/" 2>/dev/null || true
cp -f "${ROOT}/config/personas.yaml" "${DEST}/config/" 2>/dev/null || true

mkdir -p "${DEST}/extensions" "${DEST}/skills"
rsync -a \
  "${ROOT}/extensions/digital-chief-of-staff/" "${DEST}/extensions/digital-chief-of-staff/"
rsync -a \
  "${ROOT}/extensions/jina/" "${DEST}/extensions/jina/"

mkdir -p "${DEST}/docker"
cp -f "${ROOT}/docker/"dcos-*.json "${DEST}/docker/" 2>/dev/null || true

if [[ -d "${ROOT}/skills/meddpicc-coach" ]]; then
  rsync -a "${ROOT}/skills/meddpicc-coach/" "${DEST}/skills/meddpicc-coach/"
fi

chmod +x "${DEST}/scripts/"*.sh 2>/dev/null || true

cat >"${DEST}/README.md" <<'EOF'
# Public install-scripts mirror

Copied from `elastic/digital-chief-of-staff` on each release tag.  
**Do not edit by hand** — run `scripts/sync-install-scripts-mirror.sh` from the source repo.

Field `curl` install:

```bash
curl -fsSL https://raw.githubusercontent.com/poulsbopete/digital-chief-of-staff-releases/main/install-scripts/scripts/install.sh | bash
```

Windows: see `scripts/install.ps1` in this tree.
EOF

ok "Mirror ready (${DEST})"
