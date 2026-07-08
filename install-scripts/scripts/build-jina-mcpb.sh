#!/usr/bin/env bash
# Build Claude Desktop extension: dist/jina.mcpb
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${ROOT_DIR}/dist/jina-mcpb-staging"
OUT="${ROOT_DIR}/dist/jina.mcpb"
MANIFEST="${ROOT_DIR}/extensions/jina/manifest.json"

if [[ ! -f "${MANIFEST}" ]]; then
  echo "Missing ${MANIFEST}" >&2
  exit 1
fi

rm -rf "${STAGE}"
mkdir -p "${STAGE}/server/lib"

cp "${MANIFEST}" "${STAGE}/manifest.json"
cp "${ROOT_DIR}/extensions/jina/server/run-jina-mcp.mjs" "${STAGE}/server/"
cp "${ROOT_DIR}/extensions/jina/server/package.json" "${STAGE}/server/"
cp "${ROOT_DIR}/lib/load-dcos-env.mjs" "${STAGE}/server/lib/"

echo "Installing mcp-remote into Jina bundle..."
(cd "${STAGE}/server" && npm install --omit=dev --silent)

mkdir -p "${ROOT_DIR}/dist"
rm -f "${OUT}"
(cd "${STAGE}" && zip -qr "${OUT}" manifest.json server)
rm -rf "${STAGE}"

echo "Built: ${OUT}"
echo "Install: double-click jina.mcpb or run ./scripts/install.sh"
