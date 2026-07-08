#!/usr/bin/env bash
# Copy double-click helpers into ~/.config/dcos (works for repo clone + curl vendor install).
set -euo pipefail

INSTALL_DIR="${1:-${DCOS_INSTALL_DIR:-$HOME/.config/dcos}}"
ROOT_DIR="${2:-${DCOS_ROOT_DIR:-}}"

if [[ -z "$ROOT_DIR" ]]; then
  ROOT_DIR="${INSTALL_DIR}/vendor/digital-chief-of-staff"
fi

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }

write_mac_command() {
  local title="$1"
  local script_name="$2"
  local path="${INSTALL_DIR}/${title}.command"
  cat >"$path" <<'EOF'
#!/bin/bash
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
export DCOS_INSTALL_DIR="$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOLVE=""
for candidate in \
  "${DCOS_ROOT_DIR}/scripts/resolve-dcos-root.sh" \
  "$INSTALL_DIR/scripts/resolve-dcos-root.sh" \
  "$INSTALL_DIR/vendor/digital-chief-of-staff/scripts/resolve-dcos-root.sh" \
  "$SCRIPT_DIR/scripts/resolve-dcos-root.sh" \
  "$SCRIPT_DIR/vendor/digital-chief-of-staff/scripts/resolve-dcos-root.sh"; do
  if [[ -f "$candidate" ]]; then RESOLVE="$candidate"; break; fi
done
if [[ -z "$RESOLVE" && -f "$INSTALL_DIR/scripts/sync-vendor-cache.sh" ]]; then
  bash "$INSTALL_DIR/scripts/sync-vendor-cache.sh"
  RESOLVE="$INSTALL_DIR/scripts/resolve-dcos-root.sh"
fi
if [[ -z "$RESOLVE" ]]; then
  echo "DCOS scripts missing — run install.sh again or double-click Ensure DCOS Ready.command"
  read -r -p "Press Enter to close…"
  exit 1
fi
# shellcheck source=/dev/null
source "$RESOLVE"
ROOT="$(resolve_dcos_root)" || {
  echo "Syncing DCOS vendor cache…"
  bash "$INSTALL_DIR/vendor/digital-chief-of-staff/scripts/sync-vendor-cache.sh" 2>/dev/null || \
    bash "$(dirname "$RESOLVE")/sync-vendor-cache.sh"
  ROOT="$(resolve_dcos_root)"
}
export DCOS_ROOT_DIR="$ROOT"
export DCOS_INSTALL_DIR="$INSTALL_DIR"
bash "$ROOT/scripts/SCRIPT_NAME"
echo ""
read -r -p "Press Enter to close…"
EOF
  sed -i.bak "s/SCRIPT_NAME/${script_name}/" "$path" 2>/dev/null || \
    sed -i "s/SCRIPT_NAME/${script_name}/" "$path"
  rm -f "${path}.bak"
  chmod +x "$path"
}

write_mac_node_command() {
  local title="$1"
  local script_name="$2"
  local path="${INSTALL_DIR}/${title}.command"
  cat >"$path" <<'EOF'
#!/bin/bash
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
export DCOS_INSTALL_DIR="$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOLVE=""
for candidate in \
  "${DCOS_ROOT_DIR}/scripts/resolve-dcos-root.sh" \
  "$INSTALL_DIR/scripts/resolve-dcos-root.sh" \
  "$INSTALL_DIR/vendor/digital-chief-of-staff/scripts/resolve-dcos-root.sh" \
  "$SCRIPT_DIR/scripts/resolve-dcos-root.sh" \
  "$SCRIPT_DIR/vendor/digital-chief-of-staff/scripts/resolve-dcos-root.sh"; do
  if [[ -f "$candidate" ]]; then RESOLVE="$candidate"; break; fi
done
if [[ -z "$RESOLVE" && -f "$INSTALL_DIR/scripts/sync-vendor-cache.sh" ]]; then
  bash "$INSTALL_DIR/scripts/sync-vendor-cache.sh"
  RESOLVE="$INSTALL_DIR/scripts/resolve-dcos-root.sh"
fi
if [[ -z "$RESOLVE" ]]; then
  echo "DCOS scripts missing — run install.sh again or double-click Ensure DCOS Ready.command"
  read -r -p "Press Enter to close…"
  exit 1
fi
# shellcheck source=/dev/null
source "$RESOLVE"
ROOT="$(resolve_dcos_root)" || {
  echo "Syncing DCOS vendor cache…"
  bash "$INSTALL_DIR/vendor/digital-chief-of-staff/scripts/sync-vendor-cache.sh" 2>/dev/null || \
    bash "$(dirname "$RESOLVE")/sync-vendor-cache.sh"
  ROOT="$(resolve_dcos_root)"
}
export DCOS_ROOT_DIR="$ROOT"
export DCOS_INSTALL_DIR="$INSTALL_DIR"
node "$ROOT/scripts/SCRIPT_NAME"
echo ""
read -r -p "Press Enter to close…"
EOF
  sed -i.bak "s/SCRIPT_NAME/${script_name}/" "$path" 2>/dev/null || \
    sed -i "s/SCRIPT_NAME/${script_name}/" "$path"
  rm -f "${path}.bak"
  chmod +x "$path"
}

write_win_bat() {
  local title="$1"
  local script_name="$2"
  local path="${INSTALL_DIR}/${title}.bat"
  cat >"$path" <<EOF
@echo off
set "INSTALL_DIR=%DCOS_INSTALL_DIR%"
if not defined INSTALL_DIR set "INSTALL_DIR=%USERPROFILE%\\.config\\dcos"
set "ROOT=${ROOT_DIR//\//\\}"
if not exist "%ROOT%\\scripts\\${script_name}" set "ROOT=%INSTALL_DIR%\\vendor\\digital-chief-of-staff"
set "DCOS_ROOT_DIR=%ROOT%"
set "DCOS_INSTALL_DIR=%INSTALL_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\\scripts\\${script_name%.sh}.ps1"
pause
EOF
}

mkdir -p "$INSTALL_DIR"

# Bootstrap helpers so double-click works even before vendor sync (DMG / partial install).
mkdir -p "${INSTALL_DIR}/scripts"
for helper in resolve-dcos-root.sh sync-vendor-cache.sh; do
  if [[ -f "${ROOT_DIR}/scripts/${helper}" ]]; then
    cp -f "${ROOT_DIR}/scripts/${helper}" "${INSTALL_DIR}/scripts/${helper}"
    chmod +x "${INSTALL_DIR}/scripts/${helper}"
  fi
done

write_mac_command "Refresh Google Auth" "refresh-google-auth.sh"
write_mac_command "Refresh Claude Extension" "refresh-claude-extension.sh"
write_mac_command "Ensure DCOS Ready" "ensure-dcos-ready.sh"
write_mac_node_command "Verify BigQuery CRM" "verify-bq-crm.mjs"
write_mac_command "Install MEDDPICC Coach" "install-meddpicc-coach-skill.sh"
write_mac_command "Setup BigQuery CRM" "setup-bigquery-crm.sh"
write_mac_command "Install Jina" "install-jina-extension.sh"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    write_win_bat "Refresh Google Auth" "refresh-google-auth.sh"
    write_win_bat "Ensure DCOS Ready" "ensure-dcos-ready.mjs"
    write_win_bat "Install MEDDPICC Coach" "install-meddpicc-coach-skill.sh"
    ;;
esac

cat >"${INSTALL_DIR}/README-helpers.txt" <<EOF
DCOS helpers (double-click on macOS, or run from Terminal)

  ${INSTALL_DIR}/Refresh Google Auth.command
    BigQuery: gcloud auth application-default login + verify

  ${INSTALL_DIR}/Verify BigQuery CRM.command
    Test BigQuery CRM after auth (no manual node path needed)

  ${INSTALL_DIR}/Refresh Claude Extension.command
    Sync latest DCOS/Jina MCP code into Claude Desktop

  ${INSTALL_DIR}/Ensure DCOS Ready.command
    Start local Elasticsearch + verify extensions

  ${INSTALL_DIR}/Install MEDDPICC Coach.command
    Build/upload meddpicc-coach.skill for Claude Desktop Skills

  ${INSTALL_DIR}/Setup BigQuery CRM.command
    Configure RevOps certified BigQuery tables in env.sh

  ${INSTALL_DIR}/Install Jina.command
    Install Jina web research connector separately

Config: ${INSTALL_DIR}/env.sh
Skill upload: ${INSTALL_DIR}/meddpicc-coach.skill
EOF

ok "Helper launchers → ${INSTALL_DIR} (*.command / README-helpers.txt)"
