#!/usr/bin/env bash
# Start local Elasticsearch at login (macOS launchd) — needed for 15-min CRM sync + briefs.
set -euo pipefail

INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
ENV_FILE="${INSTALL_DIR}/env.sh"
LABEL="com.elastic.dcos.elasticsearch"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${DCOS_ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
ES_CTL="${ROOT_DIR}/scripts/dcos-elasticsearchctl.sh"

if [[ ! -f "$ES_CTL" ]]; then
  ES_CTL="${INSTALL_DIR}/vendor/digital-chief-of-staff/scripts/dcos-elasticsearchctl.sh"
fi
[[ -f "$ES_CTL" ]] || { echo "dcos-elasticsearchctl.sh not found" >&2; exit 1; }

mkdir -p "${HOME}/Library/LaunchAgents"
[[ -f "$ENV_FILE" ]] || touch "$ENV_FILE"

RUN_CMD="export HOME=\"${HOME}\"; export PATH=\"/usr/local/bin:/opt/homebrew/bin:\${HOME}/.local/bin:\${PATH}\"; bash \"${ES_CTL}\" start"

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
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/dcos-elasticsearch.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/dcos-elasticsearch.err</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"

bash "$ES_CTL" start || true
echo "✓ Elasticsearch will start at login (launchd: ${LABEL})"
echo "  Logs: /tmp/dcos-elasticsearch.log"
