#!/usr/bin/env bash
# Package skills/sa-quota-brief/ as sa-quota-brief.skill for Claude Desktop upload.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/skills/sa-quota-brief"
OUT_DIR="${ROOT}/dist"
OUT="${OUT_DIR}/sa-quota-brief.skill"

if [[ ! -f "${SRC}/SKILL.md" ]]; then
  echo "Missing ${SRC}/SKILL.md" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT"
(
  cd "${ROOT}/skills"
  zip -r -X "$OUT" sa-quota-brief/ -x "*.DS_Store"
)

echo "Built ${OUT} ($(du -h "$OUT" | awk '{print $1}'))"
