#!/usr/bin/env bash
# Build and start local Elasticsearch (Docker or Podman Compose).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.elasticsearch.yml"
COMPOSE_PODMAN_COMPAT="${ROOT_DIR}/docker/docker-compose.elasticsearch.podman-compat.yml"

NO_START=false
NO_CACHE_FLAG=""
PODMAN_COMPAT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-start) NO_START=true ;;
    --no-cache) NO_CACHE_FLAG="--no-cache" ;;
    --podman-compat) PODMAN_COMPAT=true ;;
    -h | --help)
      echo "Usage: $(basename "$0") [--no-start] [--no-cache] [--podman-compat]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

[[ "${DCOS_PODMAN_COMPAT:-}" == "1" || "${DCOS_PODMAN_COMPAT:-}" == "true" ]] && PODMAN_COMPAT=true

cd "${ROOT_DIR}"

COMPOSE_BACKEND=""
if [[ -n "${DCOS_CONTAINER_RUNTIME:-}" ]]; then
  COMPOSE_BACKEND="${DCOS_CONTAINER_RUNTIME}"
else
  if docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE_BACKEND=docker
  elif podman info >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
    COMPOSE_BACKEND=podman
  else
    echo "No Docker or Podman found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/" >&2
    exit 1
  fi
fi

compose_cmd() {
  case "${COMPOSE_BACKEND}" in
    docker) docker compose "$@" ;;
    podman) podman compose "$@" ;;
  esac
}

COMPOSE_ARGS=(-f "${COMPOSE_FILE}")
[[ "${PODMAN_COMPAT}" == true ]] && COMPOSE_ARGS+=(-f "${COMPOSE_PODMAN_COMPAT}")

export DCOS_ELASTIC_PASSWORD="${DCOS_ELASTIC_PASSWORD:-changeme}"

echo "Using: ${COMPOSE_BACKEND} compose"
compose_cmd "${COMPOSE_ARGS[@]}" build ${NO_CACHE_FLAG} elasticsearch

if [[ "${NO_START}" == true ]]; then
  echo "Image built (--no-start)."
  exit 0
fi

compose_cmd "${COMPOSE_ARGS[@]}" up -d elasticsearch
echo "Elasticsearch starting on http://localhost:9200 …"
