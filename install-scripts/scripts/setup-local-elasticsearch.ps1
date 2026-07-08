# Install local Elasticsearch, create API key, init indices, write config.
# Default: native zip (no Docker/Kubernetes). Set DCOS_ES_USE_DOCKER=1 for containers (Git Bash).
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$InstallDir = if ($env:DCOS_INSTALL_DIR) { $env:DCOS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".config\dcos" }
$EsUrl = if ($env:ELASTICSEARCH_URL) { $env:ELASTICSEARCH_URL.TrimEnd("/") } else { "http://127.0.0.1:9200" }

function Write-Log($msg) { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

function Test-EsNoAuth {
  try {
    Invoke-WebRequest -Uri "$EsUrl/_cluster/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch { return $false }
}

function Test-EsPassword([string]$pass) {
  if (-not $pass) { return $false }
  $pair = "elastic:$pass"
  $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
  try {
    Invoke-WebRequest -Uri "$EsUrl/_cluster/health" -Headers @{ Authorization = "Basic $b64" } -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch { return $false }
}

function Detect-ExistingEs {
  if (Test-EsNoAuth) {
    Write-Ok "Found Elasticsearch at $EsUrl (no auth — reusing existing cluster)"
    $env:DCOS_LOCAL_ELASTICSEARCH_INSECURE = "1"
    return $true
  }
  $candidates = @()
  if ($env:DCOS_ELASTIC_PASSWORD) { $candidates += $env:DCOS_ELASTIC_PASSWORD }
  $pwFile = Join-Path $InstallDir "elasticsearch\elastic.password"
  if (Test-Path $pwFile) { $candidates += (Get-Content $pwFile -Raw).Trim() }
  $envFile = Join-Path $InstallDir "env.ps1"
  if (Test-Path $envFile) { . $envFile }
  if ($env:DCOS_ELASTIC_PASSWORD) { $candidates += $env:DCOS_ELASTIC_PASSWORD }
  $candidates += "changeme"
  foreach ($p in $candidates) {
    if (Test-EsPassword $p) {
      $env:DCOS_ELASTIC_PASSWORD = $p
      Write-Ok "Found Elasticsearch at $EsUrl (reusing existing cluster)"
      return $true
    }
  }
  return $false
}

function Start-Elasticsearch {
  $env:ELASTICSEARCH_URL = $EsUrl
  if (Detect-ExistingEs) { return }
  if ($env:DCOS_ES_USE_DOCKER -eq "1") {
    Write-Err "Docker install on Windows requires Git Bash: bash scripts/setup-local-elasticsearch.sh"
  }
  Write-Log "Installing Elasticsearch locally (no Docker/Kubernetes)…"
  & (Join-Path $RootDir "scripts\install-native-elasticsearch.ps1")
}

function Ensure-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err "Node.js 18+ is required. Install from https://nodejs.org"
  }
  $major = [int](node -p "process.versions.node.split('.')[0]")
  if ($major -lt 18) { Write-Err "Node.js 18+ required (found $(node -v))" }
}

function Create-ApiKeyAndEnv {
  Ensure-Node
  Write-Log "Creating API key and writing config…"
  if (-not $env:DCOS_ELASTIC_PASSWORD) {
    $pwFile = Join-Path $InstallDir "elasticsearch\elastic.password"
    if (Test-Path $pwFile) { $env:DCOS_ELASTIC_PASSWORD = (Get-Content $pwFile -Raw).Trim() }
  }
  $jsonFile = [System.IO.Path]::GetTempFileName()
  try {
    node (Join-Path $RootDir "scripts\create-local-es-api-key.mjs") | Set-Content -Path $jsonFile -Encoding UTF8
    $json = Get-Content $jsonFile -Raw | ConvertFrom-Json
    $script:EsUrl = $json.elasticsearch_url
    $script:ApiKey = $json.claude_extension.elasticsearch_api_key
    Write-Ok "Wrote $(Join-Path $InstallDir 'env.ps1')"
  } finally {
    Remove-Item $jsonFile -Force -ErrorAction SilentlyContinue
  }
}

function Init-Indices {
  Write-Log "Creating DCOS indices…"
  $env:DCOS_VENDOR_ROOT = $RootDir
  . (Join-Path $InstallDir "env.ps1")
  node (Join-Path $RootDir "scripts\init-dcos-indices.mjs")
  Write-Ok "Indices ready (dcos_notes, dcos_opportunities, dcos_activities, dcos_signals)"
}

function Write-ClaudeSnippet {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $apiLine = if ($ApiKey) { $ApiKey } else { "*(leave blank — local cluster has security disabled)*" }
  @"
Paste into Claude Desktop → Digital Chief of Staff extension settings:

Elasticsearch URL:
$EsUrl

Elasticsearch API key:
$apiLine
"@ | Set-Content -Path (Join-Path $InstallDir "claude-extension-elasticsearch.txt") -Encoding UTF8
  Write-Ok "Saved $(Join-Path $InstallDir 'claude-extension-elasticsearch.txt')"
  if ($ApiKey) {
    try { Set-Clipboard -Value $ApiKey; Write-Ok "API key copied to clipboard" } catch { }
  }
}

function Print-Summary {
  Write-Host ""
  Write-Host "Elasticsearch ready" -ForegroundColor White
  Write-Host "  URL:     $EsUrl"
  if ($ApiKey) {
    $short = if ($ApiKey.Length -gt 24) { $ApiKey.Substring(0, 24) + "…" } else { $ApiKey }
    Write-Host "  API key: $short (full key in $(Join-Path $InstallDir 'claude-extension-elasticsearch.txt'))"
  } else {
    Write-Host "  API key: not required (local security disabled)"
  }
  Write-Host ""
  Write-Host "  Stop:  powershell -File `"$(Join-Path $RootDir 'scripts\dcos-elasticsearchctl.ps1')`" stop"
  Write-Host "  Start: powershell -File `"$(Join-Path $RootDir 'scripts\dcos-elasticsearchctl.ps1')`" start"
}

Start-Elasticsearch
Create-ApiKeyAndEnv
Init-Indices
Write-ClaudeSnippet
Print-Summary
