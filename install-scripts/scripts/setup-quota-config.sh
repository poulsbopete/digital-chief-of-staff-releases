#!/usr/bin/env bash
# Create or update ~/.config/dcos/quota.yaml from example or Peter's template.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
QUOTA_FILE="${INSTALL_DIR}/quota.yaml"
TEMPLATE="${1:-${ROOT}/config/quota-peter-simkins.yaml}"
[[ -f "$TEMPLATE" ]] || TEMPLATE="${ROOT}/config/quota.yaml.example"

mkdir -p "$INSTALL_DIR"

if [[ -f "$QUOTA_FILE" ]]; then
  echo "Quota config exists: $QUOTA_FILE"
  echo "Edit rep names, quota amounts, and period start/end dates."
  exit 0
fi

cp "$TEMPLATE" "$QUOTA_FILE"
echo "Created $QUOTA_FILE from $(basename "$TEMPLATE")"
echo "Edit quotas, then run: node scripts/verify-quota.mjs"
