#!/usr/bin/env bash
# Download scripts and index mappings when install.sh runs without a repo clone.
set -euo pipefail

REPO="${DCOS_GITHUB_REPO:-elastic/digital-chief-of-staff}"
REF="${DCOS_GITHUB_REF:-main}"
PREFIX="${DCOS_RAW_PREFIX:-}"
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
VENDOR_DIR="${DCOS_VENDOR_DIR:-$INSTALL_DIR/vendor/digital-chief-of-staff}"
RAW="https://raw.githubusercontent.com/${REPO}/${REF}/${PREFIX}"

log() { printf '\033[1;34m→\033[0m %s\n' "$*" >&2; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*" >&2; }

fetch_one() {
  local rel="$1"
  local dest="${VENDOR_DIR}/${rel}"
  mkdir -p "$(dirname "$dest")"
  curl -fsSL "${RAW}/${rel}" -o "$dest"
}

main() {
  need_cmd curl
  log "Downloading installer components from GitHub (${REPO}/${REF}/${PREFIX})…"
  mkdir -p "$VENDOR_DIR"

  local files=(
    scripts/setup-local-elasticsearch.sh
    scripts/setup-local-elasticsearch.ps1
    scripts/install-native-elasticsearch.sh
    scripts/install-native-elasticsearch.ps1
    scripts/setup-user-profile.mjs
    lib/dcos-profile.mjs
    scripts/ensure-node.sh
    scripts/seed-claude-extension-config.mjs
    scripts/seed-claude-jina-extension.mjs
    scripts/build-jina-mcpb.sh
    extensions/jina/manifest.json
    extensions/jina/server/run-jina-mcp.mjs
    extensions/jina/server/package.json
    scripts/install-jina-extension.sh
    scripts/cleanup-installer-dmg.sh
    extensions/digital-chief-of-staff/manifest.json
    scripts/create-local-es-api-key.mjs
    lib/load-dcos-env.mjs
    scripts/init-dcos-indices.mjs
    scripts/init-dcos-indices.sh
    scripts/salesforce-login.sh
    scripts/salesforce-login.ps1
    scripts/enable-sfdc-sync-schedule.sh
    scripts/enable-sfdc-sync-schedule.ps1
    scripts/install.ps1
    scripts/dcos-elasticsearchctl.ps1
    scripts/refresh-google-auth.sh
    scripts/refresh-claude-extension.sh
    scripts/resolve-dcos-root.sh
    scripts/sync-vendor-cache.sh
    scripts/stage-dcos-launchers.sh
    scripts/download-release-asset.sh
    scripts/setup-bigquery-crm.sh
    scripts/install-meddpicc-coach-skill.sh
    scripts/build-meddpicc-coach-skill.sh
    scripts/verify-bq-crm.mjs
    scripts/ensure-local-elasticsearch.mjs
    scripts/ensure-dcos-ready.mjs
    scripts/ensure-dcos-ready.sh
    scripts/dcos-elasticsearchctl.sh
    lib/bq-crm.mjs
    lib/crm-backend.mjs
    lib/ensure-local-elasticsearch.mjs
    lib/paths.mjs
    skills/meddpicc-coach/SKILL.md
    skills/meddpicc-coach/references/manager-coaching.md
    skills/meddpicc-coach/references/drill-questions.md
    skills/meddpicc-coach/references/personas.md
    skills/meddpicc-coach/assets/meddpicc-app.jsx
    config/connectors.yaml.example
    config/personas.yaml
    docker/dcos-notes-index.json
    docker/dcos-opportunities-index.json
    docker/dcos-signals-index.json
    docker/dcos-activities-index.json
  )

  local f
  for f in "${files[@]}"; do
    fetch_one "$f"
  done

  chmod +x "${VENDOR_DIR}/scripts/"*.sh 2>/dev/null || true
  ok "Cached at ${VENDOR_DIR}"
  printf '%s\n' "$VENDOR_DIR"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}

main "$@"
