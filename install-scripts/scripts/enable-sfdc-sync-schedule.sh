#!/usr/bin/env bash
# Enable background CRM → Elasticsearch sync every 15 minutes (macOS launchd).
# Works with BigQuery (RevOps certified) or Salesforce CLI — reads ~/.config/dcos/env.sh.
set -euo pipefail

INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
ENV_FILE="${INSTALL_DIR}/env.sh"
LABEL="com.elastic.dcos.sfdc-sync"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG="/tmp/dcos-sfdc-sync.log"
ERR="/tmp/dcos-sfdc-sync.err"
INTERVAL="${DCOS_SFDC_SYNC_INTERVAL_SEC:-900}"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${DCOS_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
SYNC_SCRIPT="${ROOT_DIR}/scripts/sfdc-sync.mjs"

if [[ ! -f "$SYNC_SCRIPT" ]]; then
  SYNC_SCRIPT="${INSTALL_DIR}/vendor/digital-chief-of-staff/scripts/sfdc-sync.mjs"
fi
if [[ ! -f "$SYNC_SCRIPT" ]]; then
  warn "sfdc-sync.mjs not found — run install.sh first"
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  warn "node not on PATH"
  exit 1
fi

mkdir -p "$INSTALL_DIR" "${HOME}/Library/LaunchAgents"
[[ -f "$ENV_FILE" ]] || touch "$ENV_FILE"

set_env() {
  local key="$1" val="$2"
  if grep -q "^export ${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^export ${key}=.*|export ${key}=\"${val}\"|" "$ENV_FILE" 2>/dev/null || \
      sed -i "s|^export ${key}=.*|export ${key}=\"${val}\"|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '\nexport %s="%s"\n' "$key" "$val" >>"$ENV_FILE"
  fi
}

set_env "DCOS_ROOT_DIR" "$ROOT_DIR"

ES_CTL="${ROOT_DIR}/scripts/dcos-elasticsearchctl.sh"
if [[ ! -f "$ES_CTL" ]]; then
  ES_CTL="${INSTALL_DIR}/vendor/digital-chief-of-staff/scripts/dcos-elasticsearchctl.sh"
fi

ENSURE_ES="${ROOT_DIR}/scripts/ensure-local-elasticsearch.mjs"
if [[ ! -f "$ENSURE_ES" ]]; then
  ENSURE_ES="${INSTALL_DIR}/vendor/digital-chief-of-staff/scripts/ensure-local-elasticsearch.mjs"
fi

RUN_CMD="export HOME=\"${HOME}\"; export PATH=\"/usr/local/bin:/opt/homebrew/bin:\${HOME}/.local/bin:\${PATH}\"; export DCOS_ROOT_DIR=\"${ROOT_DIR}\"; "
if [[ -f "$ENSURE_ES" ]]; then
  RUN_CMD+="\"${NODE_BIN}\" \"${ENSURE_ES}\" --repair || true; "
elif [[ -f "$ES_CTL" ]]; then
  RUN_CMD+="bash \"${ES_CTL}\" start 2>/dev/null || true; "
fi
RUN_CMD+="source \"${ENV_FILE}\"; \"${NODE_BIN}\" \"${SYNC_SCRIPT}\""

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>${RUN_CMD}</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR}</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"

if [[ -f "${ROOT_DIR}/scripts/enable-es-launchagent.sh" ]]; then
  bash "${ROOT_DIR}/scripts/enable-es-launchagent.sh" || warn "Could not enable Elasticsearch at login"
fi

ES_URL="${ELASTICSEARCH_URL:-http://127.0.0.1:9200}"
ES_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${ES_URL}" 2>/dev/null || echo 000)"
if [[ "$ES_CODE" == "000" ]]; then
  warn "Local Elasticsearch is not reachable at ${ES_URL} — sync needs ES running."
  echo "  Start: ${ROOT_DIR}/scripts/dcos-elasticsearchctl.sh start"
  echo "  Sync will retry every $((INTERVAL / 60)) minutes once ES is up."
fi

log "Running initial CRM sync (BigQuery or Salesforce per env.sh)…"
/bin/bash -lc "$RUN_CMD" || warn "Initial sync failed — check ${ERR} (BigQuery: gcloud auth application-default login)"

ok "Background CRM sync enabled (every $((INTERVAL / 60)) minutes)"
echo "  Source: BigQuery when DCOS_CRM_SOURCE=bigquery in ${ENV_FILE}"
echo "  Plist: ${PLIST}"
echo "  Logs:  ${LOG}"
echo "  Check: launchctl print gui/$(id -u)/${LABEL} | head -20"
