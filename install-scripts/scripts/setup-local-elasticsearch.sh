#!/usr/bin/env bash
# Install local Elasticsearch, create API key, init DCOS indices, write env.
# Default: native tarball (no Docker/Kubernetes). Set DCOS_ES_USE_DOCKER=1 for containers.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }

LOCAL_ES_URL="http://127.0.0.1:9200"

is_placeholder_es_url() {
  local url="${1:-}"
  [[ -z "$url" ]] && return 0
  [[ "$url" == *YOUR-PROJECT* || "$url" == *YOUR_ENCODED* ]] && return 0
  return 1
}

fix_placeholder_env_url() {
  local env_file="${INSTALL_DIR}/env.sh"
  [[ -f "$env_file" ]] || return 0
  if grep -qE 'YOUR-PROJECT|YOUR_ENCODED' "$env_file" 2>/dev/null; then
    warn "Replacing placeholder Elasticsearch settings in env.sh with local defaults"
    if [[ "$(uname -s)" == Darwin ]]; then
      sed -i '' 's|^export ELASTICSEARCH_URL=.*|export ELASTICSEARCH_URL="http://127.0.0.1:9200"|' "$env_file"
      sed -i '' 's|^export ELASTICSEARCH_API_KEY=.*|# export ELASTICSEARCH_API_KEY=  # set after local ES setup|' "$env_file"
    else
      sed -i 's|^export ELASTICSEARCH_URL=.*|export ELASTICSEARCH_URL="http://127.0.0.1:9200"|' "$env_file"
      sed -i 's|^export ELASTICSEARCH_API_KEY=.*|# export ELASTICSEARCH_API_KEY=  # set after local ES setup|' "$env_file"
    fi
  fi
}

resolve_local_elasticsearch_url() {
  if is_placeholder_es_url "${ELASTICSEARCH_URL:-}"; then
    export ELASTICSEARCH_URL="$LOCAL_ES_URL"
  fi
}

try_es_password() {
  local pass="$1"
  curl -sf -u "elastic:${pass}" "${ELASTICSEARCH_URL:-$LOCAL_ES_URL}/_cluster/health" >/dev/null 2>&1
}

es_responds_without_auth() {
  curl -sf "${ELASTICSEARCH_URL:-$LOCAL_ES_URL}/_cluster/health" >/dev/null 2>&1
}

detect_existing_elasticsearch() {
  resolve_local_elasticsearch_url
  export ELASTICSEARCH_URL="${ELASTICSEARCH_URL:-$LOCAL_ES_URL}"

  if es_responds_without_auth; then
    ok "Found Elasticsearch at ${ELASTICSEARCH_URL} (no auth — reusing existing cluster)"
    export DCOS_LOCAL_ELASTICSEARCH_INSECURE=1
    return 0
  fi

  local candidates=()
  [[ -n "${DCOS_ELASTIC_PASSWORD:-}" ]] && candidates+=("$DCOS_ELASTIC_PASSWORD")
  if [[ -f "${INSTALL_DIR}/elasticsearch/elastic.password" ]]; then
    candidates+=("$(cat "${INSTALL_DIR}/elasticsearch/elastic.password")")
  fi
  if [[ -f "${INSTALL_DIR}/env.sh" ]]; then
    # shellcheck disable=SC1091
    source "${INSTALL_DIR}/env.sh" 2>/dev/null || true
    resolve_local_elasticsearch_url
    [[ -n "${DCOS_ELASTIC_PASSWORD:-}" ]] && candidates+=("$DCOS_ELASTIC_PASSWORD")
  fi
  candidates+=("changeme")

  local pass
  for pass in "${candidates[@]}"; do
    [[ -z "$pass" ]] && continue
    if try_es_password "$pass"; then
      export DCOS_ELASTIC_PASSWORD="$pass"
      ok "Found Elasticsearch at ${ELASTICSEARCH_URL} (reusing existing cluster)"
      return 0
    fi
  done
  return 1
}

container_running() {
  docker ps --filter name=dcos-elasticsearch --format '{{.Names}}' 2>/dev/null | grep -q '^dcos-elasticsearch$' ||
    podman ps --filter name=dcos-elasticsearch --format '{{.Names}}' 2>/dev/null | grep -q '^dcos-elasticsearch$'
}

generate_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 18 | tr -d '/+=' | head -c 20
  else
    echo "dcos-local-$(date +%s | tail -c 8)"
  fi
}

start_elasticsearch_docker() {
  if ! docker info >/dev/null 2>&1 && ! podman info >/dev/null 2>&1; then
    err "DCOS_ES_USE_DOCKER=1 but Docker/Podman is not running."
    exit 1
  fi

  export DCOS_ELASTIC_PASSWORD="${DCOS_ELASTIC_PASSWORD:-$(generate_password)}"
  local extra=()
  if [[ "${DCOS_PODMAN_COMPAT:-}" == "1" ]]; then
    extra+=(--podman-compat)
  elif podman info >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
    extra+=(--podman-compat)
  fi
  bash "${ROOT_DIR}/scripts/build-local-elasticsearch.sh" "${extra[@]}"
  ok "Container dcos-elasticsearch started"
}

start_elasticsearch() {
  fix_placeholder_env_url
  resolve_local_elasticsearch_url
  export ELASTICSEARCH_URL="${ELASTICSEARCH_URL:-$LOCAL_ES_URL}"

  if detect_existing_elasticsearch; then
    return 0
  fi

  if container_running; then
    warn "dcos-elasticsearch container already running — reusing"
    export DCOS_ELASTIC_PASSWORD="${DCOS_ELASTIC_PASSWORD:-changeme}"
    return 0
  fi

  if [[ "${DCOS_ES_USE_DOCKER:-0}" == "1" ]]; then
    log "Starting Elasticsearch via Docker (optional path)…"
    start_elasticsearch_docker
    return 0
  fi

  log "Installing Elasticsearch locally (no Docker/Kubernetes)…"
  export ELASTICSEARCH_URL="$LOCAL_ES_URL"
  bash "${ROOT_DIR}/scripts/install-native-elasticsearch.sh"
}

create_api_key_and_env() {
  need_node
  log "Creating API key and writing config…"
  export DCOS_ELASTIC_PASSWORD="${DCOS_ELASTIC_PASSWORD:-}"
  if [[ -z "${DCOS_ELASTIC_PASSWORD:-}" && -f "${INSTALL_DIR}/elasticsearch/elastic.password" ]]; then
    export DCOS_ELASTIC_PASSWORD="$(cat "${INSTALL_DIR}/elasticsearch/elastic.password")"
  fi
  export ELASTICSEARCH_URL="${ELASTICSEARCH_URL:-$LOCAL_ES_URL}"
  local json_file
  json_file="$(mktemp)"
  node "${ROOT_DIR}/scripts/create-local-es-api-key.mjs" >"$json_file"
  ES_URL="$(node -pe "JSON.parse(require('fs').readFileSync('${json_file}','utf8')).elasticsearch_url")"
  API_KEY="$(node -pe "JSON.parse(require('fs').readFileSync('${json_file}','utf8')).claude_extension.elasticsearch_api_key")"
  rm -f "$json_file"
  ok "Wrote ${INSTALL_DIR}/env.sh"
}

need_node() {
  # shellcheck source=ensure-node.sh
  source "${ROOT_DIR}/scripts/ensure-node.sh"
  ensure_node
}

init_indices() {
  log "Creating DCOS indices…"
  # shellcheck disable=SC1091
  source "${INSTALL_DIR}/env.sh"
  export DCOS_VENDOR_ROOT="$ROOT_DIR"
  node "${ROOT_DIR}/scripts/init-dcos-indices.mjs"
  ok "Indices ready (dcos_notes, dcos_opportunities, dcos_activities, dcos_signals)"
}

write_claude_snippet() {
  mkdir -p "$INSTALL_DIR"
  cat >"${INSTALL_DIR}/claude-extension-elasticsearch.txt" <<EOF
Paste into Claude Desktop → Digital Chief of Staff extension settings:

Elasticsearch URL:
${ES_URL}

Elasticsearch API key:
${API_KEY:-*(leave blank — local cluster has security disabled)*}
EOF
  ok "Saved ${INSTALL_DIR}/claude-extension-elasticsearch.txt"
  if [[ -n "$API_KEY" ]] && [[ "$(uname -s)" == Darwin ]] && command -v pbcopy >/dev/null; then
    printf '%s' "$API_KEY" | pbcopy
    ok "API key copied to clipboard"
  fi
}

print_summary() {
  cat <<EOF

$(printf '\033[1mElasticsearch ready\033[0m')

  URL:     ${ES_URL}
$(if [[ -n "$API_KEY" ]]; then
  echo "  API key: ${API_KEY:0:24}… (full key in ${INSTALL_DIR}/claude-extension-elasticsearch.txt)"
else
  echo "  API key: not required (local security disabled)"
fi)

  Stop native ES:  ${ROOT_DIR}/scripts/dcos-elasticsearchctl.sh stop
  Start native ES: ${ROOT_DIR}/scripts/dcos-elasticsearchctl.sh start

EOF
}

main() {
  start_elasticsearch
  create_api_key_and_env
  init_indices
  write_claude_snippet
  print_summary
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo ""
  echo "  Digital Chief of Staff — Elasticsearch setup"
  echo "  ──────────────────────────────────────────"
  echo ""
  main "$@"
fi
