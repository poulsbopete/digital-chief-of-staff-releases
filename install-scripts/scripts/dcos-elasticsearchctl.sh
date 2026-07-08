#!/usr/bin/env bash
# Start/stop/status for native DCOS Elasticsearch (no Docker).
set -euo pipefail

INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
ES_VERSION="${DCOS_ES_VERSION:-8.17.2}"
ES_BASE="${DCOS_ES_BASE:-$INSTALL_DIR/elasticsearch}"
ES_HOME="${ES_BASE}/elasticsearch-${ES_VERSION}"
ES_PID_FILE="${ES_BASE}/elasticsearch.pid"
ES_LOGS="${ES_BASE}/logs"

cmd="${1:-status}"

pid_running() {
  [[ -f "$ES_PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$ES_PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

http_up() {
  curl -sf "http://127.0.0.1:9200/" >/dev/null 2>&1
}

case "$cmd" in
  start)
    if http_up; then
      echo "Elasticsearch already responding on http://127.0.0.1:9200"
      exit 0
    fi
    if [[ ! -x "${ES_HOME}/bin/elasticsearch" ]]; then
      echo "Elasticsearch not installed. Run ./scripts/install.sh" >&2
      exit 1
    fi
    ES_JAVA_OPTS="${ES_JAVA_OPTS:--Xms512m -Xmx512m}" \
      "${ES_HOME}/bin/elasticsearch" -d -p "$ES_PID_FILE"
    echo "Starting… logs: ${ES_LOGS}"
    ;;
  stop)
    if pid_running; then
      kill "$(cat "$ES_PID_FILE")" 2>/dev/null || true
      rm -f "$ES_PID_FILE"
      echo "Stopped Elasticsearch"
    else
      echo "Elasticsearch is not running"
    fi
    ;;
  status)
    if http_up; then
      echo "running — http://127.0.0.1:9200"
    elif pid_running; then
      echo "starting (pid $(cat "$ES_PID_FILE"))"
    else
      echo "stopped"
    fi
    ;;
  *)
    echo "Usage: $(basename "$0") {start|stop|status}" >&2
    exit 1
    ;;
esac
