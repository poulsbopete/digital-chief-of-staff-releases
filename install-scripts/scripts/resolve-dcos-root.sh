#!/usr/bin/env bash
# Resolve DCOS repo/bundle root: env → env.sh → vendor cache → script-relative.
set -euo pipefail

INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
VENDOR_DIR="${INSTALL_DIR}/vendor/digital-chief-of-staff"
MARKER="scripts/verify-bq-crm.mjs"

has_root() {
  [[ -n "${1:-}" && -f "${1}/${MARKER}" ]]
}

resolve_dcos_root() {
  if has_root "${DCOS_ROOT_DIR:-}"; then
    printf '%s\n' "$DCOS_ROOT_DIR"
    return 0
  fi

  local env_file="${INSTALL_DIR}/env.sh"
  if [[ -f "$env_file" ]]; then
    local from_env
    from_env="$(grep '^export DCOS_ROOT_DIR=' "$env_file" 2>/dev/null | head -1 | sed -E 's/^export DCOS_ROOT_DIR="(.*)"$/\1/' || true)"
    if has_root "$from_env"; then
      printf '%s\n' "$from_env"
      return 0
    fi
  fi

  if has_root "$VENDOR_DIR"; then
    printf '%s\n' "$VENDOR_DIR"
    return 0
  fi

  local script_root
  script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if has_root "$script_root"; then
    printf '%s\n' "$script_root"
    return 0
  fi

  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  resolve_dcos_root || {
    echo "DCOS scripts not found. Re-run install.sh or: bash scripts/sync-vendor-cache.sh" >&2
    exit 1
  }
fi
