#!/usr/bin/env bash
# Preflight + optional repair for local Elasticsearch and Claude Desktop extensions.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=resolve-dcos-root.sh
source "${SCRIPT_DIR}/resolve-dcos-root.sh"

ROOT_DIR="$(resolve_dcos_root 2>/dev/null || true)"
if [[ -z "$ROOT_DIR" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
export DCOS_ROOT_DIR="$ROOT_DIR"

REPAIR=1
JSON=0
for arg in "$@"; do
  case "$arg" in
    --check) REPAIR=0 ;;
    --repair) REPAIR=1 ;;
    --json) JSON=1 ;;
  esac
done

ARGS=()
[[ "$REPAIR" == "1" ]] && ARGS+=(--repair)
[[ "$JSON" == "1" ]] && ARGS+=(--json)

if ((${#ARGS[@]} > 0)); then
  node "${ROOT_DIR}/scripts/ensure-dcos-ready.mjs" "${ARGS[@]}"
else
  node "${ROOT_DIR}/scripts/ensure-dcos-ready.mjs"
fi
