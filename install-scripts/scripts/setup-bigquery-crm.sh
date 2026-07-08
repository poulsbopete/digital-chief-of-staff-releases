#!/usr/bin/env bash
# Configure Google BigQuery as the CRM data source (Salesforce tables in BQ).
set -euo pipefail

INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
ENV_FILE="${INSTALL_DIR}/env.sh"

# Elastic defaults
DEFAULT_PROJECT="elastic-edm-prod"
DEFAULT_LOCATION="US"
DEFAULT_CREDS="$HOME/.config/dcos/bigquery-sa.json"

# RevOps Business Certified (recommended)
CERT_DATASET="revops__rpt"
CERT_TABLE_OPPORTUNITY="revops__rpt.revops_rpt__business_certified_pipeline_review"
CERT_TABLE_ACCOUNT="csg__mart.csg_mart__dim_account"

# Raw SFDC staging (alternative)
STG_DATASET="ent__stg"
STG_TABLE_ACCOUNT="stg_salesforce__account"
STG_TABLE_OPPORTUNITY="stg_salesforce__opportunity"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }

mkdir -p "$INSTALL_DIR"
[[ -f "$ENV_FILE" ]] || touch "$ENV_FILE"

set_env() {
  local key="$1" val="$2"
  if grep -q "^export ${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^export ${key}=.*|export ${key}=\"${val}\"|" "$ENV_FILE" 2>/dev/null || \
      sed -i "s|^export ${key}=.*|export ${key}=\"${val}\"|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '\nexport %s="%s"\n' "$key" "$val" >>"$ENV_FILE"
  fi
}

if grep -q '^export DCOS_BQ_PROJECT_ID=' "$ENV_FILE" 2>/dev/null; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  if [[ -n "${DCOS_BQ_PROJECT_ID:-}" && -n "${DCOS_BQ_DATASET:-}" ]]; then
    ok "BigQuery CRM already configured (project: ${DCOS_BQ_PROJECT_ID}, dataset: ${DCOS_BQ_DATASET})"
    read -r -p "Reconfigure? [y/N] " re
    [[ "${re:-N}" =~ ^[Yy]$ ]] || exit 0
  fi
fi

echo ""
log "Google BigQuery CRM setup"
echo "  DCOS reads pipeline data from BigQuery — no Salesforce CLI required."
echo ""
echo "  Data source:"
echo "    [1] RevOps Business Certified (recommended) — #revops-data-support"
echo "    [2] Raw SFDC staging (ent__stg)"
read -r -p "Choose [1/2]: " source_choice
source_choice="${source_choice:-1}"

case "$source_choice" in
  2)
    DEFAULT_DATASET="$STG_DATASET"
    DEFAULT_TABLE_ACCOUNT="$STG_TABLE_ACCOUNT"
    DEFAULT_TABLE_OPPORTUNITY="$STG_TABLE_OPPORTUNITY"
    ;;
  *)
    DEFAULT_DATASET="$CERT_DATASET"
    DEFAULT_TABLE_ACCOUNT="$CERT_TABLE_ACCOUNT"
    DEFAULT_TABLE_OPPORTUNITY="$CERT_TABLE_OPPORTUNITY"
    ;;
esac

echo ""
echo "  Using: ${DEFAULT_PROJECT} — Opportunity: ${DEFAULT_TABLE_OPPORTUNITY}"
echo "         Account: ${DEFAULT_TABLE_ACCOUNT}"
echo ""

read -r -p "GCP project ID [${DEFAULT_PROJECT}]: " project_id
project_id="${project_id:-$DEFAULT_PROJECT}"
read -r -p "BigQuery dataset [${DEFAULT_DATASET}]: " dataset
dataset="${dataset:-$DEFAULT_DATASET}"
read -r -p "Account table [${DEFAULT_TABLE_ACCOUNT}]: " table_account
table_account="${table_account:-$DEFAULT_TABLE_ACCOUNT}"
read -r -p "Opportunity table [${DEFAULT_TABLE_OPPORTUNITY}]: " table_opportunity
table_opportunity="${table_opportunity:-$DEFAULT_TABLE_OPPORTUNITY}"
read -r -p "Service account JSON path [${DEFAULT_CREDS}]: " creds
creds="${creds:-$DEFAULT_CREDS}"
creds="${creds/#\~/$HOME}"
read -r -p "BigQuery location [${DEFAULT_LOCATION}]: " location
location="${location:-$DEFAULT_LOCATION}"

if [[ ! -f "$creds" ]]; then
  warn "Credentials file not found yet: $creds"
  echo "  Request access via #revops-data-support (certified datasets) or GCP admin."
  echo "  Needs: roles/bigquery.dataViewer + roles/bigquery.jobUser on ${project_id}"
  echo "  Then place the JSON at the path above and re-run verify."
fi

set_env "DCOS_CRM_SOURCE" "bigquery"
set_env "DCOS_BQ_PROJECT_ID" "$project_id"
set_env "DCOS_BQ_DATASET" "$dataset"
set_env "DCOS_BQ_TABLE_ACCOUNT" "$table_account"
set_env "DCOS_BQ_TABLE_OPPORTUNITY" "$table_opportunity"
set_env "DCOS_BQ_CREDENTIALS_PATH" "$creds"
set_env "DCOS_BQ_LOCATION" "$location"
set_env "GOOGLE_APPLICATION_CREDENTIALS" "$creds"

ok "Saved BigQuery CRM settings to $ENV_FILE"
echo ""
echo "  Tables: Account=${table_account}, Opportunity=${table_opportunity}"
echo "  Optional: DCOS_BQ_TABLE_TASK, DCOS_BQ_TABLE_EVENT for activity sync"
echo ""
echo "  Test: node scripts/verify-bq-crm.mjs"
echo "  Then restart Claude Desktop and run dcos_sfdc_auth_status"
