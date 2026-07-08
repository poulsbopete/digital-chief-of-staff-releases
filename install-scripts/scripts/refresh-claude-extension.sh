#!/usr/bin/env bash
# Rebuild/sync DCOS + Jina Claude Desktop extensions from repo or vendor cache.
set -euo pipefail

ROOT_DIR="${DCOS_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
export DCOS_ROOT_DIR="$ROOT_DIR"

if [[ ! -f "${ROOT_DIR}/scripts/sync-claude-extension-from-mcpb.mjs" ]]; then
  echo "DCOS scripts not found at ${ROOT_DIR}" >&2
  echo "Re-run install.sh or clone https://github.com/elastic/digital-chief-of-staff" >&2
  exit 1
fi

if [[ -f "${ROOT_DIR}/scripts/build-dcos-mcpb.sh" ]]; then
  echo "Building latest digital-chief-of-staff.mcpb (includes BigQuery CRM)…"
  bash "${ROOT_DIR}/scripts/build-dcos-mcpb.sh"
  node "${ROOT_DIR}/scripts/stage-mcpb.mjs" \
    --in "${ROOT_DIR}/dist/digital-chief-of-staff.mcpb" \
    --out "${INSTALL_DIR}/digital-chief-of-staff.mcpb"
fi

if [[ -f "${ROOT_DIR}/scripts/build-jina-mcpb.sh" ]]; then
  echo "Building latest jina.mcpb…"
  bash "${ROOT_DIR}/scripts/build-jina-mcpb.sh"
  cp "${ROOT_DIR}/dist/jina.mcpb" "${INSTALL_DIR}/jina.mcpb"
fi

echo "Syncing server code into Claude extension folders…"
node "${ROOT_DIR}/scripts/sync-claude-extension-from-mcpb.mjs"
node "${ROOT_DIR}/scripts/sync-claude-jina-extension-from-mcpb.mjs"

node "${ROOT_DIR}/scripts/seed-claude-extension-config.mjs"
node "${ROOT_DIR}/scripts/seed-claude-jina-extension.mjs"

echo ""
echo "Done. Quit Claude Desktop completely (Cmd+Q), reopen."
