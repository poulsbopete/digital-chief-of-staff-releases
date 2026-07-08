#!/usr/bin/env bash
# Digital Chief of Staff — single installer (Elasticsearch + Claude extension + Salesforce)
# Usage:
#   ./scripts/install.sh              # from repo clone
#   curl -fsSL .../install.sh | bash  # download components + .mcpb
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)"
if [[ -f "${_SCRIPT_DIR}/../config/github-repos.defaults.sh" ]]; then
  # shellcheck source=/dev/null
  source "${_SCRIPT_DIR}/../config/github-repos.defaults.sh"
fi
REPO="${DCOS_GITHUB_REPO:-elastic/digital-chief-of-staff}"
RELEASES_REPO="${DCOS_RELEASES_REPO:-poulsbopete/digital-chief-of-staff-releases}"
MCPB_NAME="digital-chief-of-staff.mcpb"
JINA_MCPB_NAME="jina.mcpb"
MIN_NODE_MAJOR=18

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [[ -n "$SCRIPT_PATH" && "$SCRIPT_PATH" != bash && "$SCRIPT_PATH" != sh ]]; then
  ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
else
  ROOT_DIR=""
fi

INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
MCPB_PATH="${DCOS_MCPB_PATH:-$INSTALL_DIR/$MCPB_NAME}"
JINA_MCPB_PATH="${DCOS_JINA_MCPB_PATH:-$INSTALL_DIR/$JINA_MCPB_NAME}"
SKIP_ES="${DCOS_SKIP_ELASTICSEARCH:-0}"
SKIP_SF="${DCOS_SKIP_SALESFORCE:-0}"
SKIP_JINA="${DCOS_SKIP_JINA:-0}"
JINA_INSTALLED=0

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "Missing required command: $1"; exit 1; }
}

# shellcheck source=ensure-node.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ensure-node.sh"

check_node() {
  ensure_node
  ok "Node $(node -v)"
}

ensure_root_dir() {
  if [[ -n "$ROOT_DIR" && -f "${ROOT_DIR}/scripts/setup-local-elasticsearch.sh" ]]; then
    return 0
  fi
  if [[ -f "${ROOT_DIR}/config/github-repos.defaults.sh" ]]; then
    # shellcheck source=/dev/null
    source "${ROOT_DIR}/config/github-repos.defaults.sh"
  elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/../config/github-repos.defaults.sh" ]]; then
    # shellcheck source=/dev/null
    source "$(dirname "${BASH_SOURCE[0]}")/../config/github-repos.defaults.sh"
  fi
  log "Fetching installer scripts (no git clone required)…"
  need_cmd curl
  if [[ -f "$(dirname "${BASH_SOURCE[0]}")/fetch-install-scripts.sh" ]]; then
    ROOT_DIR="$(bash "$(dirname "${BASH_SOURCE[0]}")/fetch-install-scripts.sh")"
  else
    ROOT_DIR="$(curl -fsSL "https://raw.githubusercontent.com/${RELEASES_REPO}/main/install-scripts/scripts/fetch-install-scripts.sh" | bash)"
  fi
  ok "Using cached scripts at ${ROOT_DIR}"
}

bootstrap_config() {
  mkdir -p "$INSTALL_DIR"
  local examples_dir="${ROOT_DIR}/config"
  if [[ ! -f "$INSTALL_DIR/env.sh" ]]; then
    if [[ "$SKIP_ES" == "1" && -d "$examples_dir" && -f "$examples_dir/dcos-env.example.sh" ]]; then
      cp "$examples_dir/dcos-env.example.sh" "$INSTALL_DIR/env.sh"
      ok "Created $INSTALL_DIR/env.sh (Elastic Cloud template — set ELASTICSEARCH_URL)"
    else
      cat >"$INSTALL_DIR/env.sh" <<'EOF'
# Digital Chief of Staff — populated by install.sh
export ELASTICSEARCH_URL="http://127.0.0.1:9200"
export DCOS_SF_ORG_ALIAS="dcos"
EOF
      ok "Created $INSTALL_DIR/env.sh"
    fi
  fi
  if [[ -d "$examples_dir" ]]; then
    if [[ ! -f "$INSTALL_DIR/connectors.yaml" ]]; then
      cp "$examples_dir/connectors.yaml.example" "$INSTALL_DIR/connectors.yaml"
      ok "Created $INSTALL_DIR/connectors.yaml"
    fi
    if [[ ! -f "$INSTALL_DIR/personas.yaml" && -f "$examples_dir/personas.yaml" ]]; then
      cp "$examples_dir/personas.yaml" "$INSTALL_DIR/personas.yaml"
    fi
  elif [[ ! -f "$INSTALL_DIR/env.sh" ]]; then
    cat >"$INSTALL_DIR/env.sh" <<'EOF'
# Digital Chief of Staff — populated by install.sh
export ELASTICSEARCH_URL="http://127.0.0.1:9200"
export DCOS_SF_ORG_ALIAS="dcos"
EOF
    ok "Created $INSTALL_DIR/env.sh"
  fi
}

latest_release_mcpb_url() {
  need_cmd curl
  curl -sfL "https://api.github.com/repos/${RELEASES_REPO}/releases/latest" \
    | grep -Eo '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+\.mcpb"' \
    | head -1 \
    | sed -E 's/.*"([^"]+\.mcpb)".*/\1/' || true
}

latest_release_jina_mcpb_url() {
  need_cmd curl
  curl -sfL "https://api.github.com/repos/${RELEASES_REPO}/releases/latest" \
    | grep -Eo '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*jina\.mcpb"' \
    | head -1 \
    | sed -E 's/.*"([^"]+\.mcpb)".*/\1/' || true
}

download_mcpb() {
  local url
  url="$(latest_release_mcpb_url)"
  if [[ -z "$url" ]]; then
    return 1
  fi
  log "Downloading latest Claude extension from GitHub…"
  mkdir -p "$(dirname "$MCPB_PATH")"
  curl -sfL --retry 3 -o "$MCPB_PATH" "$url"
  ok "Downloaded $MCPB_PATH"
  return 0
}

download_jina_mcpb() {
  local url dest
  url="$(latest_release_jina_mcpb_url)"
  if [[ -z "$url" ]]; then
    return 1
  fi
  dest="${INSTALL_DIR}/${JINA_MCPB_NAME}"
  log "Downloading Jina connector from GitHub…"
  mkdir -p "$(dirname "$dest")"
  curl -sfL --retry 3 -o "$dest" "$url"
  JINA_MCPB_PATH="$dest"
  ok "Downloaded $JINA_MCPB_PATH"
  return 0
}

find_jina_mcpb() {
  local candidate
  for candidate in \
    "$JINA_MCPB_PATH" \
    "${INSTALL_DIR}/${JINA_MCPB_NAME}" \
    "${ROOT_DIR}/${JINA_MCPB_NAME}" \
    "${ROOT_DIR}/dist/${JINA_MCPB_NAME}"; do
    if [[ -f "$candidate" ]]; then
      JINA_MCPB_PATH="$candidate"
      return 0
    fi
  done
  return 1
}

stage_jina_mcpb() {
  find_jina_mcpb || return 1
  if [[ "$JINA_MCPB_PATH" != "${INSTALL_DIR}/${JINA_MCPB_NAME}" ]]; then
    mkdir -p "$INSTALL_DIR"
    cp -f "$JINA_MCPB_PATH" "${INSTALL_DIR}/${JINA_MCPB_NAME}"
    JINA_MCPB_PATH="${INSTALL_DIR}/${JINA_MCPB_NAME}"
    ok "Staged Jina connector at ${JINA_MCPB_PATH}"
  fi
  return 0
}

build_mcpb_local() {
  check_node
  need_cmd npm
  log "Building .mcpb locally…"
  bash "${ROOT_DIR}/scripts/build-dcos-mcpb.sh"
  MCPB_PATH="${ROOT_DIR}/dist/${MCPB_NAME}"
  ok "Built $MCPB_PATH"
}

build_jina_mcpb_local() {
  check_node
  log "Building Jina .mcpb locally…"
  bash "${ROOT_DIR}/scripts/build-jina-mcpb.sh"
  JINA_MCPB_PATH="${ROOT_DIR}/dist/${JINA_MCPB_NAME}"
  ok "Built $JINA_MCPB_PATH"
}

ensure_jina_mcpb() {
  if [[ "$SKIP_JINA" == "1" ]]; then
    log "Skipping Jina connector (DCOS_SKIP_JINA=1)"
    return 0
  fi

  if find_jina_mcpb; then
    ok "Using existing $JINA_MCPB_PATH"
    stage_jina_mcpb || true
    JINA_INSTALLED=1
    return 0
  fi

  if download_jina_mcpb; then
    JINA_INSTALLED=1
    return 0
  fi

  if [[ -f "${ROOT_DIR}/scripts/build-jina-mcpb.sh" && -f "${ROOT_DIR}/extensions/jina/manifest.json" ]]; then
    build_jina_mcpb_local
    stage_jina_mcpb || true
    JINA_INSTALLED=1
    return 0
  fi

  warn "Jina connector not installed — web research will be unavailable until you install jina.mcpb"
  echo "  Fix: double-click Install Jina.command or download jina.mcpb from:"
  echo "  https://digital-chief-of-staff-releases.vercel.app/"
  return 1
}

setup_jina_api_key() {
  if [[ "$SKIP_JINA" == "1" ]]; then
    return 0
  fi

  local env_file="${INSTALL_DIR}/env.sh"
  [[ -f "$env_file" ]] || return 0

  if grep -q '^export JINA_API_KEY=' "$env_file" 2>/dev/null; then
    local existing
    existing="$(grep '^export JINA_API_KEY=' "$env_file" | sed -E 's/^export JINA_API_KEY="([^"]*)".*/\1/')"
    if [[ -n "$existing" && "$existing" != "YOUR_JINA_API_KEY" ]]; then
      ok "Jina API key already in env.sh"
      return 0
    fi
  fi

  if [[ ! -t 0 ]]; then
    return 0
  fi

  echo ""
  log "Jina web research (morning briefs use this for news and trigger events)"
  echo "  Free API key: https://jina.ai"
  read -r -p "Paste Jina API key (or Enter to skip): " jina_key
  if [[ -z "${jina_key:-}" ]]; then
    warn "Skipped Jina API key — add export JINA_API_KEY=\"jina_...\" to ${env_file} later"
    return 0
  fi

  if grep -q '^export JINA_API_KEY=' "$env_file" 2>/dev/null; then
    sed -i '' "s|^export JINA_API_KEY=.*|export JINA_API_KEY=\"${jina_key}\"|" "$env_file" 2>/dev/null || \
      sed -i "s|^export JINA_API_KEY=.*|export JINA_API_KEY=\"${jina_key}\"|" "$env_file"
  else
    printf '\nexport JINA_API_KEY="%s"\n' "$jina_key" >>"$env_file"
  fi
  ok "Saved JINA_API_KEY to ${env_file}"
}

ensure_mcpb() {
  if [[ -f "$MCPB_PATH" && "${1:-}" != "--rebuild" ]]; then
    ok "Using existing $MCPB_PATH"
    return 0
  fi

  if [[ -n "$ROOT_DIR" && -f "${ROOT_DIR}/${MCPB_NAME}" && "${1:-}" != "--rebuild" ]]; then
    MCPB_PATH="${ROOT_DIR}/${MCPB_NAME}"
    ok "Using ${MCPB_PATH}"
    return 0
  fi

  if [[ -n "$ROOT_DIR" && -f "${ROOT_DIR}/dist/${MCPB_NAME}" && "${1:-}" != "--rebuild" ]]; then
    MCPB_PATH="${ROOT_DIR}/dist/${MCPB_NAME}"
    ok "Using ${MCPB_PATH}"
    return 0
  fi

  if download_mcpb; then
    return 0
  fi

  if [[ -f "${ROOT_DIR}/scripts/build-dcos-mcpb.sh" ]]; then
    build_mcpb_local
    return 0
  fi

  err "No .mcpb found."
  echo "  Download manually: https://github.com/${RELEASES_REPO}/releases"
  echo "  Or: https://digital-chief-of-staff-releases.vercel.app/"
  exit 1
}

setup_user_profile() {
  if [[ "${DCOS_SKIP_PROFILE:-0}" == "1" ]]; then
    log "Skipping profile setup (DCOS_SKIP_PROFILE=1)"
    return 0
  fi
  ensure_root_dir
  check_node
  echo ""
  log "Your role & account watchlist"
  DCOS_ROOT_DIR="$ROOT_DIR" node "${ROOT_DIR}/scripts/setup-user-profile.mjs" || warn "Profile setup skipped — run ./scripts/setup-user-profile.mjs later"
}

seed_claude_extension() {
  if [[ ! -f "${INSTALL_DIR}/env.sh" && ! -f "${INSTALL_DIR}/env.ps1" ]]; then
    return 0
  fi
  log "Enabling Claude extensions (credentials from ~/.config/dcos/env.sh)…"
  DCOS_ROOT_DIR="$ROOT_DIR" node "${ROOT_DIR}/scripts/seed-claude-extension-config.mjs" || warn "Could not write DCOS Claude settings — run Refresh Claude Extension.command"
  if [[ "$SKIP_JINA" != "1" && -f "${ROOT_DIR}/scripts/seed-claude-jina-extension.mjs" ]]; then
    DCOS_ROOT_DIR="$ROOT_DIR" node "${ROOT_DIR}/scripts/seed-claude-jina-extension.mjs" || warn "Could not write Jina Claude settings — run Refresh Claude Extension.command"
  fi
}

setup_elasticsearch() {
  if [[ "$SKIP_ES" == "1" ]]; then
    log "Skipping Elasticsearch (DCOS_SKIP_ELASTICSEARCH=1)"
    return 0
  fi

  ensure_root_dir
  check_node
  need_cmd curl

  echo ""
  log "Step 1/3 — Elasticsearch (native install, no Docker/Kubernetes)"
  bash "${ROOT_DIR}/scripts/setup-local-elasticsearch.sh"
}

open_mcpb_in_claude() {
  local path="$1"
  local label="${2:-Claude extension}"

  if [[ ! -f "$path" ]]; then
    warn "Missing ${label}: ${path}"
    return 1
  fi

  case "$(uname -s)" in
    Darwin)
      if open -a "Claude" "$path" 2>/dev/null; then
        ok "Claude Desktop should open the ${label} install dialog"
      else
        warn "Could not launch Claude.app — double-click ${path}"
        open "$path" || true
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      if command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -NoProfile -Command "Start-Process -FilePath '$path'"
        ok "Opening ${label} in Claude Desktop"
      else
        warn "Double-click ${path} in Claude Desktop → Settings → Extensions"
      fi
      ;;
    *)
      warn "Open ${path} in Claude Desktop → Settings → Extensions → Install Extension"
      ;;
  esac
}

wait_for_extension_install() {
  local label="$1"
  if [[ "${DCOS_SKIP_MCPB_PAUSE:-0}" == "1" ]]; then
    sleep 2
    return 0
  fi
  echo ""
  if [[ -t 0 ]]; then
    warn "In Claude Desktop: confirm **${label}** is installed before continuing."
    read -r -p "Press Enter when ${label} install is done (or Ctrl+C to stop)… " _
  else
    log "Waiting ${DCOS_MCPB_INSTALL_PAUSE:-20}s for ${label} install (non-interactive)…"
    sleep "${DCOS_MCPB_INSTALL_PAUSE:-20}"
  fi
}

open_in_claude() {
  if [[ ! -f "$MCPB_PATH" ]]; then
    err "Missing $MCPB_PATH"
    exit 1
  fi

  echo ""
  log "Step 2/3 — Claude Desktop extensions"
  log "Install **Digital Chief of Staff** first; Jina comes after you confirm."
  open_mcpb_in_claude "$MCPB_PATH" "Digital Chief of Staff extension"
  wait_for_extension_install "Digital Chief of Staff"

  if [[ "$SKIP_JINA" != "1" && -f "$JINA_MCPB_PATH" ]]; then
    echo ""
    log "Now install **Jina** (web research connector)"
    open_mcpb_in_claude "$JINA_MCPB_PATH" "Jina web research connector"
    wait_for_extension_install "Jina web research"
  elif [[ "$SKIP_JINA" != "1" ]]; then
    warn "Skipping Jina install dialog — jina.mcpb not found (run Install Jina.command later)"
  fi
}

stage_user_helpers() {
  if [[ -f "${ROOT_DIR}/scripts/stage-dcos-launchers.sh" ]]; then
    bash "${ROOT_DIR}/scripts/stage-dcos-launchers.sh" "$INSTALL_DIR" "$ROOT_DIR"
  fi
}

sync_vendor_cache() {
  if [[ ! -f "${ROOT_DIR}/scripts/sync-vendor-cache.sh" ]]; then
    return 0
  fi
  log "Caching DCOS scripts under ${INSTALL_DIR}/vendor/ (survives DMG delete)…"
  local vendor
  vendor="$(bash "${ROOT_DIR}/scripts/sync-vendor-cache.sh" "$ROOT_DIR")"
  ROOT_DIR="$vendor"
  export DCOS_ROOT_DIR="$ROOT_DIR"
  ok "Using ${ROOT_DIR}"
}

setup_salesforce() {
  if [[ "$SKIP_SF" == "1" ]]; then
    log "Skipping Salesforce login (DCOS_SKIP_SALESFORCE=1)"
    setup_bigquery_crm_optional
    return 0
  fi

  echo ""
  log "Step 3/4 — CRM connection (Salesforce CLI or BigQuery)"

  local crm_choice=""
  if [[ -t 0 ]]; then
    echo ""
    echo "  [1] Salesforce CLI browser login (default)"
    echo "  [2] BigQuery CRM (elastic-edm-prod — no SF CLI needed)"
    echo "  [3] Skip for now"
    read -r -p "Choose [1/2/3]: " crm_choice
  fi

  case "${crm_choice:-1}" in
    2)
      setup_bigquery_crm
      return 0
      ;;
    3|[Nn]*)
      warn "Skip for now — run ./scripts/salesforce-login.sh or ./scripts/setup-bigquery-crm.sh when ready"
      return 0
      ;;
  esac

  if [[ -t 0 ]]; then
    read -r -p "Connect Salesforce now (browser login)? [Y/n] " sf_login
    if [[ "${sf_login:-Y}" =~ ^[Nn]$ ]]; then
      setup_bigquery_crm_optional
      return 0
    fi
  fi

  ensure_root_dir
  if [[ -f "${ROOT_DIR}/scripts/salesforce-login.sh" ]]; then
    if ! bash "${ROOT_DIR}/scripts/salesforce-login.sh"; then
      warn "Salesforce login failed — try BigQuery CRM instead"
      setup_bigquery_crm_optional
    fi
  else
    warn "Install Salesforce CLI: brew install sf && sf org login web --alias dcos"
    setup_bigquery_crm_optional
  fi
}

setup_bigquery_crm() {
  ensure_root_dir
  if [[ -f "${ROOT_DIR}/scripts/setup-bigquery-crm.sh" ]]; then
    bash "${ROOT_DIR}/scripts/setup-bigquery-crm.sh"
  else
    warn "setup-bigquery-crm.sh not found"
  fi
}

setup_bigquery_crm_optional() {
  if [[ ! -t 0 ]]; then
    return 0
  fi
  read -r -p "Set up BigQuery CRM instead (elastic-edm-prod)? [y/N] " bq_setup
  if [[ "${bq_setup:-N}" =~ ^[Yy]$ ]]; then
    setup_bigquery_crm
  fi
}

enable_sfdc_sync_schedule() {
  ensure_root_dir
  if [[ ! -f "${ROOT_DIR}/scripts/enable-sfdc-sync-schedule.sh" ]]; then
    return 0
  fi
  echo ""
  log "Step 4/5 — Background CRM sync (every 15 minutes)"
  if [[ -t 0 ]]; then
    read -r -p "Enable automatic BigQuery/Salesforce → Elasticsearch sync? [Y/n] " sync_enable
    if [[ "${sync_enable:-Y}" =~ ^[Nn]$ ]]; then
      warn "Skip for now — run ./scripts/enable-sfdc-sync-schedule.sh when ready"
      return 0
    fi
  fi
  DCOS_ROOT_DIR="$ROOT_DIR" bash "${ROOT_DIR}/scripts/enable-sfdc-sync-schedule.sh"
}

setup_meddpicc_coach_skill() {
  if [[ "${DCOS_SKIP_MEDDPICC_COACH:-0}" == "1" ]]; then
    log "Skipping MEDDPICC Coach skill (DCOS_SKIP_MEDDPICC_COACH=1)"
    return 0
  fi
  ensure_root_dir
  if [[ ! -f "${ROOT_DIR}/scripts/install-meddpicc-coach-skill.sh" ]]; then
    return 0
  fi
  echo ""
  log "Step 5/5 — MEDDPICC Coach skill (Claude training module)"
  if [[ -t 0 ]]; then
    read -r -p "Install MEDDPICC Coach skill for Claude Desktop? [Y/n] " skill_install
    if [[ "${skill_install:-Y}" =~ ^[Nn]$ ]]; then
      warn "Skip for now — run ./scripts/install-meddpicc-coach-skill.sh or Install MEDDPICC Coach.command"
      return 0
    fi
  fi
  DCOS_ROOT_DIR="$ROOT_DIR" bash "${ROOT_DIR}/scripts/install-meddpicc-coach-skill.sh"
}

print_next_steps() {
  cat <<EOF

$(printf '\033[1mInstall complete\033[0m')

  1. Claude Desktop → confirm **Digital Chief of Staff** first, then **Jina** (installer waits between dialogs)
  2. Toggle both on if needed, then restart Claude Desktop once (Cmd+Q)
  3. Connectors → Desktop should list digital-chief-of-staff + Jina (not Directory search)
  4. Helpers in **${INSTALL_DIR}** — double-click **Refresh Google Auth.command**, **Verify BigQuery CRM.command**, **Ensure DCOS Ready.command**, etc. (see README-helpers.txt)
  4b. BigQuery auth: **${INSTALL_DIR}/Refresh Google Auth.command** (creates vendor cache if missing) or \`gcloud auth application-default login\`
  4c. Scripts cache: **${INSTALL_DIR}/vendor/digital-chief-of-staff/** (always populated by install — not required to type paths manually)
$(if [[ "$SKIP_JINA" != "1" && "$JINA_INSTALLED" != "1" ]]; then
  echo "  ! Jina missing: double-click **${INSTALL_DIR}/Install Jina.command** or download jina.mcpb from the releases site"
fi)
  5. Claude chat → "Produce my morning brief" or "Run dcos_sfdc_auth_status"
  6. Claude Desktop → Settings → Capabilities → Skills → upload **${INSTALL_DIR}/meddpicc-coach.skill** → toggle ON
  7. SFDC sync runs every 15 min in the background (if enabled) — logs: /tmp/dcos-sfdc-sync.log

  Config: ${INSTALL_DIR}
  Docs:   https://github.com/${REPO}/blob/main/docs/INSTALL.md

  No Docker or Kubernetes required — Elasticsearch runs natively on this laptop.

EOF
}

main() {
  echo ""
  echo "  Digital Chief of Staff — single installer"
  echo "  ─────────────────────────────────────────"
  echo ""
  echo "  Installs: Elasticsearch + Claude extensions (DCOS + Jina) + CRM (Salesforce or BigQuery) + MEDDPICC Coach skill"
  echo "  Requires: Node.js 18+ (auto-installed if missing), curl, Claude Desktop"
  echo ""

  ensure_root_dir
  bootstrap_config
  sync_vendor_cache
  check_node
  setup_jina_api_key
  setup_user_profile
  setup_elasticsearch
  ensure_mcpb "${1:-}"
  ensure_jina_mcpb || true
  stage_user_helpers
  seed_claude_extension
  open_in_claude
  # Re-run after Claude unpacks the .mcpb (old bundles may still ship user_config fields).
  sleep 3
  seed_claude_extension || true
  setup_salesforce
  enable_sfdc_sync_schedule
  setup_meddpicc_coach_skill
  sync_vendor_cache
  stage_user_helpers
  print_next_steps
  if [[ -f "${ROOT_DIR}/scripts/cleanup-installer-dmg.sh" ]]; then
    bash "${ROOT_DIR}/scripts/cleanup-installer-dmg.sh" || true
  fi
}

main "${1:-}"
