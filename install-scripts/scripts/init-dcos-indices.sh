#!/usr/bin/env bash
# Create all DCOS Elasticsearch indices if missing.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ES_URL="${ELASTICSEARCH_URL:-}"
ES_URL="${ES_URL%/}"
if [[ -z "$ES_URL" ]]; then
  echo "Set ELASTICSEARCH_URL (Elastic Cloud Serverless HTTPS, or http://localhost:9200 for local)." >&2
  exit 1
fi

CURL_AUTH=()
if [[ -n "${ELASTICSEARCH_API_KEY:-}" ]]; then
  CURL_AUTH+=(-H "Authorization: ApiKey ${ELASTICSEARCH_API_KEY}")
elif [[ -n "${ELASTICSEARCH_BASIC_AUTH:-}" ]]; then
  CURL_AUTH+=(-H "Authorization: Basic ${ELASTICSEARCH_BASIC_AUTH}")
fi

es_curl() {
  local args=(--connect-timeout 5 --max-time 30)
  if ((${#CURL_AUTH[@]} > 0)); then
    curl "${args[@]}" "${CURL_AUTH[@]}" "$@"
  else
    curl "${args[@]}" "$@"
  fi
}

ensure_index() {
  local index="$1"
  local body="$2"
  local code
  code="$(es_curl -sS -o /dev/null -w '%{http_code}' "${ES_URL}/${index}" || true)"
  if [[ "$code" == "200" ]]; then
    echo "Index \"${index}\" already exists."
    return 0
  fi
  echo "Creating index \"${index}\"..."
  es_curl -sS -X PUT "${ES_URL}/${index}" -H "Content-Type: application/json" --data-binary "@${body}"
  echo ""
}

ensure_index "${DCOS_INDEX_NOTES:-dcos_notes}" "${ROOT_DIR}/docker/dcos-notes-index.json"
ensure_index "${DCOS_INDEX_OPPORTUNITIES:-dcos_opportunities}" "${ROOT_DIR}/docker/dcos-opportunities-index.json"
ensure_index "${DCOS_INDEX_SIGNALS:-dcos_signals}" "${ROOT_DIR}/docker/dcos-signals-index.json"
ensure_index "${DCOS_INDEX_ACTIVITIES:-dcos_activities}" "${ROOT_DIR}/docker/dcos-activities-index.json"

echo "Done."
