#!/usr/bin/env bash
# Interactive Salesforce browser login — no API keys or Connected Apps required.
# Saves session to macOS Keychain (optional) and verifies with a test SOQL query.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
KEYCHAIN_ACCOUNT="${DCOS_KEYCHAIN_ACCOUNT:-dcos}"
SF_ALIAS="${DCOS_SF_ORG_ALIAS:-dcos}"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }

export PATH="/usr/local/bin:/opt/homebrew/bin:${HOME}/.local/bin:${PATH:-}"

ensure_sf_cli() {
  if command -v sf >/dev/null 2>&1; then
    ok "Salesforce CLI: $(sf version --json 2>/dev/null | grep -Eo '"version"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 || echo sf)"
    return 0
  fi
  echo ""
  err "Salesforce CLI (sf) is not installed."
  echo ""
  echo "  Install one of:"
  echo "    macOS:  brew install sf"
  echo "    npm:    npm install -g @salesforce/cli"
  echo "    installer: https://developer.salesforce.com/tools/salesforcecli"
  echo ""
  read -r -p "Open Salesforce CLI install page in browser? [Y/n] " open_page
  if [[ ! "${open_page:-Y}" =~ ^[Nn]$ ]]; then
    open "https://developer.salesforce.com/tools/salesforcecli" 2>/dev/null || true
  fi
  exit 1
}

prompt_org_type() {
  echo ""
  echo "  Which Salesforce org are you logging into?"
  echo ""
  echo "    1) Production  (elastic.lightning.force.com, login.salesforce.com)"
  echo "    2) Sandbox     (test.salesforce.com)"
  echo ""
  read -r -p "Choice [1]: " choice
  case "${choice:-1}" in
    2|s|sandbox|Sandbox)
      SF_LOGIN_URL="https://test.salesforce.com"
      ;;
    *)
      SF_LOGIN_URL="https://login.salesforce.com"
      ;;
  esac
  log "Using ${SF_LOGIN_URL}"
}

run_browser_login() {
  echo ""
  log "Opening your browser for Salesforce login…"
  log "Sign in with your Elastic credentials, then allow access."
  echo ""
  local client_id="${SF_CLIENT_ID:-${DCOS_SF_CLIENT_ID:-}}"
  if [[ -n "$client_id" ]]; then
    log "Using org-approved Connected App (SF_CLIENT_ID / DCOS_SF_CLIENT_ID)"
    sf org login web \
      --set-default \
      --alias "$SF_ALIAS" \
      --instance-url "$SF_LOGIN_URL" \
      --client-id "$client_id"
  else
    sf org login web \
      --set-default \
      --alias "$SF_ALIAS" \
      --instance-url "$SF_LOGIN_URL"
  fi
  ok "Browser login complete (alias: ${SF_ALIAS})"
}

save_keychain() {
  [[ "$(uname -s)" == Darwin ]] || return 0
  local json token instance
  json="$(node "$ROOT_DIR/scripts/load-sf-session.mjs" 2>/dev/null | grep -v '^#' || true)"
  token="$(printf '%s\n' "$json" | grep DCOS_SF_ACCESS_TOKEN | sed -n 's/export DCOS_SF_ACCESS_TOKEN=//p' | tr -d "'")"
  instance="$(printf '%s\n' "$json" | grep DCOS_SF_INSTANCE_URL | sed -n 's/export DCOS_SF_INSTANCE_URL=//p' | tr -d "'")"
  if [[ -z "$token" || -z "$instance" ]]; then
    warn "Could not save to Keychain — CLI session still works for this login"
    return 0
  fi
  security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s dcos.salesforce.access_token -w "$token" -U 2>/dev/null || \
    security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s dcos.salesforce.access_token -w "$token"
  security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s dcos.salesforce.instance_url -w "$instance" -U 2>/dev/null || \
    security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s dcos.salesforce.instance_url -w "$instance"
  ok "Saved Salesforce session to Keychain (account: ${KEYCHAIN_ACCOUNT})"
}

write_config_note() {
  mkdir -p "$INSTALL_DIR"
  local marker="$INSTALL_DIR/.salesforce-cli-login"
  date -u +"%Y-%m-%dT%H:%M:%SZ" >"$marker"
  if [[ -f "$INSTALL_DIR/env.sh" ]] && ! grep -q DCOS_SF_ORG_ALIAS "$INSTALL_DIR/env.sh" 2>/dev/null; then
    cat >>"$INSTALL_DIR/env.sh" <<EOF

# Salesforce — browser login (no API keys). Re-run: ./scripts/salesforce-login.sh
export DCOS_SF_ORG_ALIAS="${SF_ALIAS}"
# MCP reads live session from: sf org display --target-org ${SF_ALIAS}
EOF
    ok "Updated $INSTALL_DIR/env.sh"
  fi
}

verify_connection() {
  log "Verifying connection…"
  if node "$ROOT_DIR/scripts/verify-sf-session.mjs"; then
    ok "Salesforce connected"
  else
    warn "Login succeeded but verification failed — try dcos_sfdc_list_opportunities in Claude"
  fi
}

main() {
  echo ""
  echo "  Digital Chief of Staff — Salesforce login"
  echo "  ─────────────────────────────────────────"
  echo ""
  echo "  No API keys needed. You'll sign in through your browser"
  echo "  the same way you log into Salesforce normally."
  echo ""

  ensure_sf_cli
  prompt_org_type
  run_browser_login
  save_keychain
  write_config_note
  verify_connection

  echo ""
  ok "Done — Claude Desktop can use Salesforce without pasting tokens."
  echo ""
  echo "  Re-login anytime: double-click 'Login to Salesforce.command'"
  echo "  Sessions expire — re-run this script when Salesforce tools stop working."
  echo ""
}

main "$@"
