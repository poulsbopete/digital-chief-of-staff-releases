# Interactive Salesforce browser login for Windows.
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$InstallDir = if ($env:DCOS_INSTALL_DIR) { $env:DCOS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".config\dcos" }
$SfAlias = if ($env:DCOS_SF_ORG_ALIAS) { $env:DCOS_SF_ORG_ALIAS } else { "dcos" }

function Write-Log($msg) { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

function Ensure-SfCli {
  if (Get-Command sf -ErrorAction SilentlyContinue) {
    Write-Ok "Salesforce CLI found"
    return
  }
  Write-Err @"
Salesforce CLI (sf) is not installed.

  Install from: https://developer.salesforce.com/tools/salesforcecli
  Or: npm install -g @salesforce/cli
"@
}

function Get-LoginUrl {
  Write-Host ""
  Write-Host "  Which Salesforce org are you logging into?"
  Write-Host ""
  Write-Host "    1) Production  (login.salesforce.com)"
  Write-Host "    2) Sandbox     (test.salesforce.com)"
  Write-Host ""
  $choice = Read-Host "Choice [1]"
  if ($choice -match '^(2|s|sandbox|Sandbox)$') {
    return "https://test.salesforce.com"
  }
  return "https://login.salesforce.com"
}

function Run-BrowserLogin([string]$loginUrl) {
  Write-Host ""
  Write-Log "Opening your browser for Salesforce login…"
  $clientId = if ($env:SF_CLIENT_ID) { $env:SF_CLIENT_ID } elseif ($env:DCOS_SF_CLIENT_ID) { $env:DCOS_SF_CLIENT_ID } else { $null }
  if ($clientId) {
    Write-Log "Using org-approved Connected App (SF_CLIENT_ID / DCOS_SF_CLIENT_ID)"
    sf org login web --set-default --alias $SfAlias --instance-url $loginUrl --client-id $clientId
  } else {
    sf org login web --set-default --alias $SfAlias --instance-url $loginUrl
  }
  Write-Ok "Browser login complete (alias: $SfAlias)"
}

function Write-ConfigNote {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Set-Content -Path (Join-Path $InstallDir ".salesforce-cli-login") -Value (Get-Date -Format o)
  $envPs1 = Join-Path $InstallDir "env.ps1"
  $line = "`$env:DCOS_SF_ORG_ALIAS = `"$SfAlias`""
  if (Test-Path $envPs1) {
    $content = Get-Content $envPs1 -Raw
    if ($content -notmatch "DCOS_SF_ORG_ALIAS") {
      Add-Content -Path $envPs1 -Value "`n# Salesforce browser login`n$line"
    }
  } else {
    Set-Content -Path $envPs1 -Value $line
  }
  Write-Ok "Updated $envPs1"
}

function Verify-Connection {
  Write-Log "Verifying connection…"
  $verify = Join-Path $RootDir "scripts\verify-sf-session.mjs"
  if (Test-Path $verify) {
    node $verify
    if ($LASTEXITCODE -eq 0) { Write-Ok "Salesforce connected" }
    else { Write-Warn "Login succeeded but verification failed — try dcos_sfdc_list_opportunities in Claude" }
  }
}

Write-Host ""
Write-Host "  Digital Chief of Staff — Salesforce login"
Write-Host "  ─────────────────────────────────────────"
Write-Host ""

Ensure-SfCli
$url = Get-LoginUrl
Write-Log "Using $url"
Run-BrowserLogin $url
Write-ConfigNote
Verify-Connection

Write-Host ""
Write-Ok "Done — Claude Desktop can use Salesforce without pasting tokens."
Write-Host ""
Write-Host "  Re-login anytime: double-click 'Login to Salesforce.bat'"
Write-Host ""
