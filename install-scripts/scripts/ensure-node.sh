#!/usr/bin/env bash
# Install Node.js 18+ when missing or too old (macOS/Linux).
# Source from install.sh after log/ok/warn/err are defined, or run standalone.
set -euo pipefail

MIN_NODE_MAJOR="${MIN_NODE_MAJOR:-18}"
# Bump on release — used for macOS .pkg fallback when Homebrew is unavailable.
NODE_PKG_VERSION="${NODE_PKG_VERSION:-22.16.0}"

_ensure_node_log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
_ensure_node_ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
_ensure_node_warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }
_ensure_node_err() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

log="${log:-_ensure_node_log}"
ok="${ok:-_ensure_node_ok}"
warn="${warn:-_ensure_node_warn}"
err="${err:-_ensure_node_err}"

refresh_path() {
  export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${PATH:-}"
  hash -r 2>/dev/null || true
}

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return 0
  fi
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

install_node_with_brew() {
  command -v brew >/dev/null 2>&1 || return 1
  log "Installing Node.js via Homebrew…"
  if brew list node >/dev/null 2>&1; then
    brew upgrade node || brew install node
  else
    brew install node
  fi
  refresh_path
  return 0
}

install_node_macos_pkg() {
  local pkg="/tmp/node-v${NODE_PKG_VERSION}.pkg"
  local url="https://nodejs.org/dist/v${NODE_PKG_VERSION}/node-v${NODE_PKG_VERSION}.pkg"
  log "Downloading Node.js v${NODE_PKG_VERSION}…"
  need_cmd curl
  curl -fsSL --retry 3 "$url" -o "$pkg"
  log "Installing Node.js (your Mac may prompt for an administrator password)…"
  sudo installer -pkg "$pkg" -target /
  rm -f "$pkg"
  refresh_path
}

install_node_linux_apt() {
  need_cmd() {
    command -v "$1" >/dev/null 2>&1 || { err "Missing required command: $1"; }
  }
  need_cmd sudo
  need_cmd apt-get
  log "Installing Node.js via apt…"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm
  refresh_path
}

ensure_node() {
  refresh_path
  local major
  major="$(node_major)"
  if (( major >= MIN_NODE_MAJOR )); then
    return 0
  fi

  if (( major > 0 )); then
    warn "Node $(node -v) is too old (need ${MIN_NODE_MAJOR}+)."
  else
    warn "Node.js not found — installing Node.js ${MIN_NODE_MAJOR}+…"
  fi

  if [[ "${DCOS_SKIP_NODE_INSTALL:-0}" == "1" ]]; then
    err "Node.js ${MIN_NODE_MAJOR}+ is required. Install from https://nodejs.org or unset DCOS_SKIP_NODE_INSTALL."
  fi

  if install_node_with_brew; then
    :
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    install_node_macos_pkg
  elif command -v apt-get >/dev/null 2>&1; then
    install_node_linux_apt
  else
    err "Could not auto-install Node.js on this OS. Install from https://nodejs.org"
  fi

  major="$(node_major)"
  if (( major < MIN_NODE_MAJOR )); then
    err "Node.js ${MIN_NODE_MAJOR}+ still not available after install. Open a new Terminal and run the installer again, or install from https://nodejs.org"
  fi

  ok "Node.js $(node -v) ready"
}

if [[ "${BASH_SOURCE[0]:-}" == "${0:-}" ]]; then
  need_cmd() {
    command -v "$1" >/dev/null 2>&1 || { err "Missing required command: $1"; }
  }
  ensure_node
fi
