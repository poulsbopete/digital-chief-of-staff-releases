#!/usr/bin/env bash
# Copy DCOS scripts into ~/.config/dcos/vendor/ so helpers work after DMG install or app delete.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=resolve-dcos-root.sh
source "${SCRIPT_DIR}/resolve-dcos-root.sh"

INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
VENDOR_DIR="${INSTALL_DIR}/vendor/digital-chief-of-staff"
ENV_FILE="${INSTALL_DIR}/env.sh"
SOURCE="${1:-${DCOS_ROOT_DIR:-}}"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }

if [[ -z "$SOURCE" ]]; then
  SOURCE="$(resolve_dcos_root 2>/dev/null || true)"
fi

if [[ -z "$SOURCE" || ! -f "${SOURCE}/scripts/install.sh" ]]; then
  warn "No local DCOS source — downloading scripts to vendor cache…"
  need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }; }
  need_cmd curl
  SOURCE="$(bash "${SCRIPT_DIR}/fetch-install-scripts.sh" 2>/dev/null || \
    curl -fsSL "https://raw.githubusercontent.com/poulsbopete/digital-chief-of-staff-releases/main/install-scripts/scripts/fetch-install-scripts.sh" | bash)"
fi

mkdir -p "$VENDOR_DIR"
log "Syncing DCOS scripts → ${VENDOR_DIR}"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.vercel' \
  --exclude 'dist' \
  --exclude '.env*' \
  "${SOURCE}/" "${VENDOR_DIR}/"
chmod +x "${VENDOR_DIR}/scripts/"*.sh 2>/dev/null || true
ok "Vendor cache ready"

set_env() {
  local key="$1" val="$2"
  mkdir -p "$INSTALL_DIR"
  [[ -f "$ENV_FILE" ]] || touch "$ENV_FILE"
  if grep -q "^export ${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^export ${key}=.*|export ${key}=\"${val}\"|" "$ENV_FILE" 2>/dev/null || \
      sed -i "s|^export ${key}=.*|export ${key}=\"${val}\"|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '\nexport %s="%s"\n' "$key" "$val" >>"$ENV_FILE"
  fi
}

set_env "DCOS_ROOT_DIR" "$VENDOR_DIR"
export DCOS_ROOT_DIR="$VENDOR_DIR"

if [[ -f "${VENDOR_DIR}/scripts/stage-dcos-launchers.sh" ]]; then
  bash "${VENDOR_DIR}/scripts/stage-dcos-launchers.sh" "$INSTALL_DIR" "$VENDOR_DIR"
fi

printf '%s\n' "$VENDOR_DIR"
