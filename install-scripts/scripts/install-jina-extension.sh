#!/usr/bin/env bash
# Install or repair the Jina Claude Desktop extension (web research connector).
set -euo pipefail

REPO="elastic/digital-chief-of-staff"
RELEASES_REPO="${DCOS_RELEASES_REPO:-poulsbopete/digital-chief-of-staff-releases}"
JINA_MCPB_NAME="jina.mcpb"

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [[ -n "$SCRIPT_PATH" && "$SCRIPT_PATH" != bash && "$SCRIPT_PATH" != sh ]]; then
  ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
else
  ROOT_DIR="${DCOS_ROOT_DIR:-}"
fi

INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
JINA_MCPB_PATH="${DCOS_JINA_MCPB_PATH:-$INSTALL_DIR/$JINA_MCPB_NAME}"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "Missing required command: $1"
}

ensure_root_dir() {
  if [[ -n "$ROOT_DIR" && -f "${ROOT_DIR}/scripts/seed-claude-jina-extension.mjs" ]]; then
    return 0
  fi
  log "Fetching installer scripts…"
  need_cmd curl
  local bootstrap="${ROOT_DIR}/scripts/fetch-install-scripts.sh"
  if [[ -n "$ROOT_DIR" && -f "$bootstrap" ]]; then
    ROOT_DIR="$(bash "$bootstrap")"
  else
    ROOT_DIR="$(curl -fsSL "https://raw.githubusercontent.com/${RELEASES_REPO}/main/install-scripts/scripts/fetch-install-scripts.sh" | bash)"
  fi
  ok "Using cached scripts at ${ROOT_DIR}"
}

latest_release_jina_mcpb_url() {
  curl -sfL "https://api.github.com/repos/${RELEASES_REPO}/releases/latest" \
    | grep -Eo '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*jina\.mcpb"' \
    | head -1 \
    | sed -E 's/.*"([^"]+\.mcpb)".*/\1/' || true
}

find_jina_mcpb() {
  local candidate
  for candidate in \
    "$JINA_MCPB_PATH" \
    "${INSTALL_DIR}/${JINA_MCPB_NAME}" \
    "${ROOT_DIR}/${JINA_MCPB_NAME}" \
    "${ROOT_DIR}/dist/${JINA_MCPB_NAME}"; do
    if [[ -f "$candidate" ]]; then
      JINA_MCPB_PATH="$candidate"
      return 0
    fi
  done
  return 1
}

stage_jina_mcpb() {
  find_jina_mcpb || return 1
  if [[ "$JINA_MCPB_PATH" != "${INSTALL_DIR}/${JINA_MCPB_NAME}" ]]; then
    mkdir -p "$INSTALL_DIR"
    cp -f "$JINA_MCPB_PATH" "${INSTALL_DIR}/${JINA_MCPB_NAME}"
    JINA_MCPB_PATH="${INSTALL_DIR}/${JINA_MCPB_NAME}"
    ok "Staged Jina connector at ${JINA_MCPB_PATH}"
  fi
  return 0
}

download_jina_mcpb() {
  local url dest
  url="$(latest_release_jina_mcpb_url)"
  [[ -n "$url" ]] || return 1
  dest="${INSTALL_DIR}/${JINA_MCPB_NAME}"
  log "Downloading Jina connector from GitHub…"
  mkdir -p "$(dirname "$dest")"
  curl -sfL --retry 3 -o "$dest" "$url"
  JINA_MCPB_PATH="$dest"
  ok "Downloaded $JINA_MCPB_PATH"
  return 0
}

build_jina_mcpb_local() {
  need_cmd node
  need_cmd npm
  log "Building Jina .mcpb locally…"
  bash "${ROOT_DIR}/scripts/build-jina-mcpb.sh"
  JINA_MCPB_PATH="${ROOT_DIR}/dist/${JINA_MCPB_NAME}"
  ok "Built $JINA_MCPB_PATH"
}

ensure_jina_mcpb() {
  if find_jina_mcpb; then
    ok "Using existing $JINA_MCPB_PATH"
    stage_jina_mcpb || true
    return 0
  fi
  if download_jina_mcpb; then
    return 0
  fi
  if [[ -f "${ROOT_DIR}/scripts/build-jina-mcpb.sh" && -f "${ROOT_DIR}/extensions/jina/manifest.json" ]]; then
    build_jina_mcpb_local
    stage_jina_mcpb || true
    return 0
  fi
  err "Jina connector not found. Download jina.mcpb from https://digital-chief-of-staff-releases.vercel.app/"
}

open_in_claude() {
  need_cmd open
  log "Confirm the Jina install dialog in Claude Desktop"
  open -a Claude "$JINA_MCPB_PATH" 2>/dev/null || open "$JINA_MCPB_PATH"
  ok "Opened Jina .mcpb in Claude Desktop"
}

seed_jina_extension() {
  if [[ ! -f "${ROOT_DIR}/scripts/seed-claude-jina-extension.mjs" ]]; then
    warn "seed-claude-jina-extension.mjs missing — run Refresh Claude Extension.command"
    return 0
  fi
  DCOS_ROOT_DIR="$ROOT_DIR" node "${ROOT_DIR}/scripts/seed-claude-jina-extension.mjs"
  ok "Jina Claude extension settings updated"
}

main() {
  ensure_root_dir
  ensure_jina_mcpb
  seed_jina_extension
  open_in_claude
  sleep 3
  seed_jina_extension || true
  echo ""
  ok "Jina install complete — quit Claude Desktop (Cmd+Q), reopen, and enable Jina under Connectors → Desktop"
}

main "$@"
