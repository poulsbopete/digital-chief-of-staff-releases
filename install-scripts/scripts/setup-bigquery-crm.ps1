# Configure Google BigQuery as the CRM data source (Salesforce tables in BQ).
$ErrorActionPreference = "Stop"

$DefaultProject = "elastic-edm-prod"
$DefaultLocation = "US"
$CertDataset = "revops__rpt"
$CertTableOpportunity = "revops__rpt.revops_rpt__business_certified_pipeline_review"
$CertTableAccount = "csg__mart.csg_mart__dim_account"
$StgDataset = "ent__stg"
$StgTableAccount = "stg_salesforce__account"
$StgTableOpportunity = "stg_salesforce__opportunity"

$InstallDir = if ($env:DCOS_INSTALL_DIR) { $env:DCOS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".config\dcos" }
$EnvFile = Join-Path $InstallDir "env.sh"
$DefaultCreds = Join-Path $InstallDir "bigquery-sa.json"

function Write-Log($msg) { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
if (-not (Test-Path $EnvFile)) { New-Item -ItemType File -Path $EnvFile | Out-Null }

function Set-EnvVar($Key, $Val) {
  $lines = Get-Content $EnvFile -ErrorAction SilentlyContinue
  $pattern = "^export ${Key}="
  $export = "export ${Key}=`"$Val`""
  if ($lines | Where-Object { $_ -match $pattern }) {
    $lines = $lines | ForEach-Object { if ($_ -match $pattern) { $export } else { $_ } }
  } else {
    $lines += $export
  }
  $lines | Set-Content $EnvFile -Encoding UTF8
}

Write-Host ""
Write-Log "Google BigQuery CRM setup"
Write-Host "  [1] RevOps Business Certified (recommended)"
Write-Host "  [2] Raw SFDC staging (ent__stg)"
$sourceChoice = Read-Host "Choose [1/2]"
if ($sourceChoice -eq "2") {
  $DefaultDataset = $StgDataset
  $DefaultTableAccount = $StgTableAccount
  $DefaultTableOpportunity = $StgTableOpportunity
} else {
  $DefaultDataset = $CertDataset
  $DefaultTableAccount = $CertTableAccount
  $DefaultTableOpportunity = $CertTableOpportunity
}
Write-Host ""
Write-Host "  Using Opportunity: $DefaultTableOpportunity"
Write-Host "         Account:    $DefaultTableAccount"
Write-Host ""

$projectId = Read-Host "GCP project ID [$DefaultProject]"
if ([string]::IsNullOrWhiteSpace($projectId)) { $projectId = $DefaultProject }
$dataset = Read-Host "BigQuery dataset [$DefaultDataset]"
if ([string]::IsNullOrWhiteSpace($dataset)) { $dataset = $DefaultDataset }
$tableAccount = Read-Host "Account table [$DefaultTableAccount]"
if ([string]::IsNullOrWhiteSpace($tableAccount)) { $tableAccount = $DefaultTableAccount }
$tableOpportunity = Read-Host "Opportunity table [$DefaultTableOpportunity]"
if ([string]::IsNullOrWhiteSpace($tableOpportunity)) { $tableOpportunity = $DefaultTableOpportunity }
$creds = Read-Host "Service account JSON path [$DefaultCreds]"
if ([string]::IsNullOrWhiteSpace($creds)) {
  $creds = $DefaultCreds
} else {
  $creds = $creds -replace '^~', $env:USERPROFILE
}
$location = Read-Host "BigQuery location [$DefaultLocation]"
if ([string]::IsNullOrWhiteSpace($location)) { $location = $DefaultLocation }

if (-not (Test-Path $creds)) {
  Write-Warn "Credentials file not found yet: $creds"
  Write-Host "  Request access via #revops-data-support or GCP admin."
}

Set-EnvVar "DCOS_CRM_SOURCE" "bigquery"
Set-EnvVar "DCOS_BQ_PROJECT_ID" $projectId
Set-EnvVar "DCOS_BQ_DATASET" $dataset
Set-EnvVar "DCOS_BQ_TABLE_ACCOUNT" $tableAccount
Set-EnvVar "DCOS_BQ_TABLE_OPPORTUNITY" $tableOpportunity
Set-EnvVar "DCOS_BQ_CREDENTIALS_PATH" $creds
Set-EnvVar "DCOS_BQ_LOCATION" $location
Set-EnvVar "GOOGLE_APPLICATION_CREDENTIALS" $creds

Write-Ok "Saved BigQuery CRM settings to $EnvFile"
Write-Host ""
Write-Host "  Test: node scripts/verify-bq-crm.mjs"
