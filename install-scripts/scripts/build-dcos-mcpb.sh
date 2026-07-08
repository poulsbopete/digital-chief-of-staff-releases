#!/usr/bin/env bash
# Build Claude Desktop extension: dist/digital-chief-of-staff.mcpb
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${ROOT_DIR}/dist/mcpb-staging"
OUT="${ROOT_DIR}/dist/digital-chief-of-staff.mcpb"
MANIFEST="${ROOT_DIR}/extensions/digital-chief-of-staff/manifest.json"

if [[ ! -f "${MANIFEST}" ]]; then
  echo "Missing ${MANIFEST}" >&2
  exit 1
fi

rm -rf "${STAGE}"
mkdir -p "${STAGE}/server/docs" "${STAGE}/server/config-examples"

cp "${MANIFEST}" "${STAGE}/manifest.json"
cp "${ROOT_DIR}/mcp/dcos-mcp.mjs" "${STAGE}/server/"
cp "${ROOT_DIR}/mcp/run-dcos-mcp.mjs" "${STAGE}/server/"
cp "${ROOT_DIR}/mcp/run-dcos-mcp.sh" "${STAGE}/server/"
chmod +x "${STAGE}/server/run-dcos-mcp.sh"
cp "${ROOT_DIR}/scripts/load-sf-session.mjs" "${STAGE}/server/load-sf-session.mjs"
sed -i '' 's|from "../lib/|from "./lib/|g' "${STAGE}/server/load-sf-session.mjs" 2>/dev/null || \
  sed -i 's|from "../lib/|from "./lib/|g' "${STAGE}/server/load-sf-session.mjs"
sed -i '' 's|from "../lib/|from "./lib/|g' "${STAGE}/server/dcos-mcp.mjs" 2>/dev/null || \
  sed -i 's|from "../lib/|from "./lib/|g' "${STAGE}/server/dcos-mcp.mjs"
cp "${ROOT_DIR}/mcp/package.json" "${STAGE}/server/"
cp -R "${ROOT_DIR}/lib" "${STAGE}/server/lib"
cp -R "${ROOT_DIR}/docker" "${STAGE}/server/docker"

# Ship quick-start docs inside the bundle (visible after install)
cp "${ROOT_DIR}/docs/INSTALL.md" "${STAGE}/server/docs/INSTALL.md"
cp "${ROOT_DIR}/docs/BIGQUERY_CRM.md" "${STAGE}/server/docs/BIGQUERY_CRM.md"
cp "${ROOT_DIR}/claude/project-instructions.md" "${STAGE}/server/docs/project-instructions.md"
cp "${ROOT_DIR}/claude/scheduled-morning-brief-prompt.md" "${STAGE}/server/docs/scheduled-morning-brief-prompt.md"
cp "${ROOT_DIR}/config/dcos-env.example.sh" "${STAGE}/server/config-examples/env.example.sh"
cp "${ROOT_DIR}/config/connectors.yaml.example" "${STAGE}/server/config-examples/connectors.yaml.example"

echo "Installing MCP dependencies into bundle..."
(cd "${STAGE}/server" && npm install --omit=dev --silent)

mkdir -p "${ROOT_DIR}/dist"
rm -f "${OUT}"
(cd "${STAGE}" && zip -qr "${OUT}" manifest.json server)
rm -rf "${STAGE}"

echo "Built: ${OUT}"
echo "Install: double-click the .mcpb or run ./scripts/install.sh"
