#!/usr/bin/env bash
# Refresh Google Application Default Credentials for BigQuery CRM (ADC).
set -euo pipefail

INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
ENV_FILE="${INSTALL_DIR}/env.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=resolve-dcos-root.sh
source "${SCRIPT_DIR}/resolve-dcos-root.sh"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

ROOT_DIR="$(resolve_dcos_root 2>/dev/null || true)"
if [[ -z "$ROOT_DIR" ]]; then
  warn "DCOS scripts not found locally — syncing vendor cache…"
  bash "${SCRIPT_DIR}/sync-vendor-cache.sh"
  ROOT_DIR="$(resolve_dcos_root)"
fi

if ! command -v gcloud >/dev/null 2>&1; then
  err "gcloud not found. Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
fi

project_id="elastic-edm-prod"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  project_id="${DCOS_BQ_PROJECT_ID:-$project_id}"
fi

echo ""
log "Refresh Google auth for DCOS BigQuery CRM"
echo "  Opens a browser window — sign in with your Elastic Google account."
echo "  Project: ${project_id}"
echo ""

gcloud auth application-default login

if gcloud auth application-default set-quota-project "$project_id" 2>/dev/null; then
  ok "Quota project set to ${project_id}"
else
  warn "Could not set quota project (queries may still work with ADC)"
fi

adc="$HOME/.config/gcloud/application_default_credentials.json"
if [[ -f "$adc" ]]; then
  ok "ADC saved: ${adc}"
else
  err "ADC file not found after login"
fi

log "Verifying BigQuery CRM…"
export DCOS_ROOT_DIR="$ROOT_DIR"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"
if node "${ROOT_DIR}/scripts/verify-bq-crm.mjs"; then
  ok "BigQuery CRM verified"
else
  warn "Verification failed — check #revops-data-support for dataset access"
  exit 1
fi

echo ""
ok "Done. Quit Claude Desktop (Cmd+Q), reopen, then run dcos_sfdc_auth_status in a brief."
echo ""
echo "  Helper saved in ~/.config/dcos/Refresh Google Auth.command (re-run install.sh to refresh)"
