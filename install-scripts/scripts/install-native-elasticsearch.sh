#!/usr/bin/env bash
# Install and start Elasticsearch from official tarball — no Docker, K8s, or Podman.
set -euo pipefail

ES_VERSION="${DCOS_ES_VERSION:-8.17.2}"
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
ES_BASE="${DCOS_ES_BASE:-$INSTALL_DIR/elasticsearch}"
ES_HOME="${ES_BASE}/elasticsearch-${ES_VERSION}"
ES_DATA="${ES_BASE}/data"
ES_LOGS="${ES_BASE}/logs"
ES_CONFIG="${ES_HOME}/config"
ES_PID_FILE="${ES_BASE}/elasticsearch.pid"
ES_PASSWORD_FILE="${ES_BASE}/elastic.password"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }

detect_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *)
      err "Unsupported OS: $(uname -s). Use Elastic Cloud or set ELASTICSEARCH_URL manually."
      exit 1
      ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=aarch64 ;;
    x86_64 | amd64) arch=x86_64 ;;
    *)
      err "Unsupported CPU: $(uname -m)"
      exit 1
      ;;
  esac
  if [[ "$os" == darwin && "$arch" == aarch64 ]]; then
    ES_PLATFORM="darwin-aarch64"
  elif [[ "$os" == darwin ]]; then
    ES_PLATFORM="darwin-x86_64"
  elif [[ "$os" == linux && "$arch" == aarch64 ]]; then
    ES_PLATFORM="linux-aarch64"
  else
    ES_PLATFORM="linux-x86_64"
  fi
}

es_responds() {
  local url="http://127.0.0.1:9200"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "${url%/}/" 2>/dev/null || echo "000")"
  # 401 means security is on but HTTP is up
  [[ "$code" == "200" || "$code" == "401" ]]
}

native_pid_running() {
  [[ -f "$ES_PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$ES_PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

install_tarball() {
  detect_platform
  local tarball="elasticsearch-${ES_VERSION}-${ES_PLATFORM}.tar.gz"
  local url="https://artifacts.elastic.co/downloads/elasticsearch/${tarball}"
  local cache="${ES_BASE}/cache/${tarball}"

  if [[ -x "${ES_HOME}/bin/elasticsearch" ]]; then
    ok "Elasticsearch ${ES_VERSION} already installed"
    return 0
  fi

  need_cmd curl
  need_cmd tar
  mkdir -p "${ES_BASE}/cache"

  if [[ ! -f "$cache" ]]; then
    log "Downloading Elasticsearch ${ES_VERSION} for ${ES_PLATFORM} (one-time, ~600 MB)…"
    curl -fL --retry 3 -o "$cache" "$url"
  fi

  log "Extracting Elasticsearch…"
  mkdir -p "$ES_BASE"
  tar -xzf "$cache" -C "$ES_BASE"

  if [[ "$(uname -s)" == Darwin ]]; then
    xattr -dr com.apple.quarantine "$ES_HOME" 2>/dev/null || true
  fi

  ok "Installed to ${ES_HOME}"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "Missing required command: $1"; exit 1; }
}

write_config() {
  mkdir -p "$ES_DATA" "$ES_LOGS"
  local cfg="${ES_HOME}/config"
  [[ -d "$cfg" ]] || err "Missing ${cfg} — delete ${ES_BASE} and re-run install"

  # Older installers used ~/.config/dcos/elasticsearch/config with only elasticsearch.yml
  local legacy="${ES_BASE}/config"
  if [[ -d "$legacy" && "$legacy" != "$cfg" ]]; then
    warn "Removing incomplete legacy config at ${legacy}"
    rm -rf "$legacy"
  fi

  cat >"${cfg}/elasticsearch.yml" <<EOF
cluster.name: dcos-local
node.name: dcos-es01
discovery.type: single-node
network.host: 127.0.0.1
http.port: 9200
xpack.security.enabled: true
xpack.security.http.ssl.enabled: false
path.data: ${ES_DATA}
path.logs: ${ES_LOGS}
EOF
}

read_password_from_logs() {
  local log_file deadline pass
  deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    for log_file in "${ES_LOGS}/dcos-local.log" "${ES_LOGS}/"*.log; do
      [[ -f "$log_file" ]] || continue
      pass="$(grep -E 'Password for the elastic user \(reset with' "$log_file" 2>/dev/null | tail -1 | awk '{print $NF}' || true)"
      if [[ -n "$pass" ]]; then
        printf '%s' "$pass"
        return 0
      fi
    done
    sleep 2
  done
  return 1
}

ensure_elastic_password() {
  if [[ -f "$ES_PASSWORD_FILE" ]]; then
    DCOS_ELASTIC_PASSWORD="$(cat "$ES_PASSWORD_FILE")"
    export DCOS_ELASTIC_PASSWORD
    return 0
  fi

  if [[ -n "${DCOS_ELASTIC_PASSWORD:-}" ]]; then
    printf '%s' "$DCOS_ELASTIC_PASSWORD" >"$ES_PASSWORD_FILE"
    chmod 600 "$ES_PASSWORD_FILE"
    return 0
  fi

  log "Waiting for Elasticsearch to print bootstrap credentials…"
  local pass
  if pass="$(read_password_from_logs)"; then
    printf '%s' "$pass" >"$ES_PASSWORD_FILE"
    chmod 600 "$ES_PASSWORD_FILE"
    DCOS_ELASTIC_PASSWORD="$pass"
    export DCOS_ELASTIC_PASSWORD
    ok "Saved elastic user password"
    return 0
  fi

  warn "Could not read password from logs — resetting elastic password"
  local reset_out pass
  reset_out="$("${ES_HOME}/bin/elasticsearch-reset-password" -u elastic -b --url "http://127.0.0.1:9200" 2>&1 || true)"
  pass="$(printf '%s\n' "$reset_out" | awk '/New value:/ {print $3; exit}')"
  if [[ -z "$pass" ]]; then
    err "Could not determine elastic password. Check ${ES_LOGS} or run: ${ES_HOME}/bin/elasticsearch-reset-password -u elastic -b"
  fi
  printf '%s' "$pass" >"$ES_PASSWORD_FILE"
  chmod 600 "$ES_PASSWORD_FILE"
  DCOS_ELASTIC_PASSWORD="$pass"
  export DCOS_ELASTIC_PASSWORD
  ok "Reset elastic user password"
}

wait_for_http() {
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if es_responds; then
      return 0
    fi
    sleep 2
  done
  err "Elasticsearch did not respond on http://127.0.0.1:9200"
  err "Logs: ${ES_LOGS}"
  exit 1
}

start_native_elasticsearch() {
  export ELASTICSEARCH_URL="http://127.0.0.1:9200"

  if es_responds; then
    ok "Elasticsearch already responding at ${ELASTICSEARCH_URL}"
    return 0
  fi

  if native_pid_running; then
    log "Elasticsearch process running — waiting for HTTP…"
    wait_for_http
    return 0
  fi

  install_tarball
  write_config

  log "Starting Elasticsearch (native, background)…"
  ES_JAVA_OPTS="${ES_JAVA_OPTS:--Xms512m -Xmx512m}" \
    "${ES_HOME}/bin/elasticsearch" \
    -d \
    -p "$ES_PID_FILE"

  wait_for_http
  ok "Elasticsearch running at ${ELASTICSEARCH_URL}"
}

main() {
  start_native_elasticsearch
  ensure_elastic_password
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
