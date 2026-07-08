# Digital Chief of Staff — single installer for Windows
# Usage: powershell -ExecutionPolicy Bypass -File scripts\install.ps1
$ErrorActionPreference = "Stop"

$Repo = "elastic/digital-chief-of-staff"
$ReleasesRepo = if ($env:DCOS_RELEASES_REPO) { $env:DCOS_RELEASES_REPO } else { "poulsbopete/digital-chief-of-staff-releases" }
$McpbName = "digital-chief-of-staff.mcpb"
$JinaMcpbName = "jina.mcpb"
$MinNodeMajor = 18

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path (Join-Path $ScriptDir "setup-local-elasticsearch.ps1")) {
  $RootDir = Split-Path -Parent $ScriptDir
} else {
  $RootDir = ""
}

$InstallDir = if ($env:DCOS_INSTALL_DIR) { $env:DCOS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".config\dcos" }
$McpbPath = if ($env:DCOS_MCPB_PATH) { $env:DCOS_MCPB_PATH } else { Join-Path $InstallDir $McpbName }
$JinaMcpbPath = if ($env:DCOS_JINA_MCPB_PATH) { $env:DCOS_JINA_MCPB_PATH } else { Join-Path $InstallDir $JinaMcpbName }
$SkipEs = if ($env:DCOS_SKIP_ELASTICSEARCH) { $env:DCOS_SKIP_ELASTICSEARCH } else { "0" }
$SkipSf = if ($env:DCOS_SKIP_SALESFORCE) { $env:DCOS_SKIP_SALESFORCE } else { "0" }
$SkipJina = if ($env:DCOS_SKIP_JINA) { $env:DCOS_SKIP_JINA } else { "0" }
$script:JinaInstalled = $false

function Write-Log($msg) { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

function Install-NodeWithWinget {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
  Write-Log "Installing Node.js LTS via winget…"
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
  return $true
}

function Ensure-Node {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $major = [int](node -p "process.versions.node.split('.')[0]")
    if ($major -ge $MinNodeMajor) {
      Write-Ok "Node $(node -v)"
      return
    }
    Write-Warn "Node $(node -v) is too old (need $MinNodeMajor+)."
  } else {
    Write-Warn "Node.js not found — installing Node.js ${MinNodeMajor}+…"
  }

  if ($env:DCOS_SKIP_NODE_INSTALL -eq "1") {
    Write-Err "Node.js $MinNodeMajor+ is required.`n  Install from https://nodejs.org"
  }

  if (-not (Install-NodeWithWinget)) {
    Write-Err "Could not auto-install Node.js.`n  Install from https://nodejs.org or run: winget install OpenJS.NodeJS.LTS"
  }

  $nodeExe = Join-Path ${env:ProgramFiles} "nodejs\node.exe"
  if ((Test-Path $nodeExe) -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
    $env:Path = "$(Split-Path $nodeExe);$env:Path"
  }

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err "Node.js installed but not on PATH yet. Open a new PowerShell window and re-run the installer."
  }

  $major = [int](node -p "process.versions.node.split('.')[0]")
  if ($major -lt $MinNodeMajor) {
    Write-Err "Node $MinNodeMajor+ required after install (found $(node -v))."
  }
  Write-Ok "Node.js $(node -v) ready"
}

function Ensure-RootDir {
  if ($RootDir -and (Test-Path (Join-Path $RootDir "scripts\setup-local-elasticsearch.ps1"))) { return }
  Write-Log "Fetching installer scripts from GitHub…"
  $repoFetch = Join-Path $ScriptDir "fetch-install-scripts.ps1"
  if (Test-Path $repoFetch) {
    $script:RootDir = & $repoFetch
  } else {
    $tmpFetch = Join-Path $env:TEMP "dcos-fetch-install-scripts.ps1"
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$ReleasesRepo/main/install-scripts/scripts/fetch-install-scripts.ps1" -OutFile $tmpFetch -UseBasicParsing
    $script:RootDir = & $tmpFetch
  }
  Write-Ok "Using cached scripts at $RootDir"
}

function Bootstrap-Config {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $example = Join-Path $RootDir "config\dcos-env.example.sh"
  $envPs1 = Join-Path $InstallDir "env.ps1"
  if (-not (Test-Path $envPs1)) {
    if (Test-Path $example) {
      Copy-Item $example (Join-Path $InstallDir "env.sh")
    } else {
      Set-Content -Path $envPs1 -Value '$env:ELASTICSEARCH_URL = "http://127.0.0.1:9200"' -Encoding UTF8
    }
    Write-Ok "Created $envPs1"
  }
  $connExample = Join-Path $RootDir "config\connectors.yaml.example"
  $conn = Join-Path $InstallDir "connectors.yaml"
  if ((Test-Path $connExample) -and -not (Test-Path $conn)) {
    Copy-Item $connExample $conn
    Write-Ok "Created $conn"
  }
  $personasExample = Join-Path $RootDir "config\personas.yaml"
  $personas = Join-Path $InstallDir "personas.yaml"
  if ((Test-Path $personasExample) -and -not (Test-Path $personas)) {
    Copy-Item $personasExample $personas
  }
}

function Setup-UserProfile {
  if ($env:DCOS_SKIP_PROFILE -eq "1") {
    Write-Log "Skipping profile setup (DCOS_SKIP_PROFILE=1)"
    return
  }
  Ensure-RootDir
  Ensure-Node
  Write-Host ""
  Write-Log "Your role & account watchlist"
  $env:DCOS_ROOT_DIR = $RootDir
  node (Join-Path $RootDir "scripts\setup-user-profile.mjs")
  if ($LASTEXITCODE -ne 0) { Write-Warn "Profile setup skipped — run scripts\setup-user-profile.mjs later" }
}

function Get-LatestMcpbUrl {
  $resp = Invoke-RestMethod -Uri "https://api.github.com/repos/$ReleasesRepo/releases/latest" -UseBasicParsing
  foreach ($a in $resp.assets) {
    if ($a.name -like "*.mcpb") { return $a.browser_download_url }
  }
  return $null
}

function Download-Mcpb {
  $url = Get-LatestMcpbUrl
  if (-not $url) { return $false }
  Write-Log "Downloading latest Claude extension from GitHub…"
  New-Item -ItemType Directory -Force -Path (Split-Path $McpbPath) | Out-Null
  Invoke-WebRequest -Uri $url -OutFile $McpbPath -UseBasicParsing
  Write-Ok "Downloaded $McpbPath"
  return $true
}

function Ensure-Mcpb {
  if (Test-Path $McpbPath) { Write-Ok "Using existing $McpbPath"; return }
  $bundled = Join-Path $RootDir $McpbName
  if ($RootDir -and (Test-Path $bundled)) {
    $script:McpbPath = $bundled
    Write-Ok "Using $McpbPath"
    return
  }
  $local = Join-Path $RootDir "dist\$McpbName"
  if ($RootDir -and (Test-Path $local)) {
    $script:McpbPath = $local
    Write-Ok "Using $McpbPath"
    return
  }
  if (Download-Mcpb) { return }
  Write-Err "No .mcpb found.`n  Download: https://github.com/$ReleasesRepo/releases`n  Or: https://digital-chief-of-staff-releases.vercel.app/"
}

function Setup-Elasticsearch {
  if ($SkipEs -eq "1") { Write-Log "Skipping Elasticsearch (DCOS_SKIP_ELASTICSEARCH=1)"; return }
  Ensure-RootDir
  Ensure-Node
  Write-Host ""
  Write-Log "Step 1/3 — Elasticsearch (native install, no Docker/Kubernetes)"
  & (Join-Path $RootDir "scripts\setup-local-elasticsearch.ps1")
}

function Get-LatestJinaMcpbUrl {
  $resp = Invoke-RestMethod -Uri "https://api.github.com/repos/$ReleasesRepo/releases/latest" -UseBasicParsing
  foreach ($a in $resp.assets) {
    if ($a.name -like "*jina.mcpb") { return $a.browser_download_url }
  }
  return $null
}

function Download-JinaMcpb {
  $url = Get-LatestJinaMcpbUrl
  if (-not $url) { return $false }
  $dest = Join-Path $InstallDir $JinaMcpbName
  Write-Log "Downloading Jina connector from GitHub…"
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  $script:JinaMcpbPath = $dest
  Write-Ok "Downloaded $JinaMcpbPath"
  return $true
}

function Find-JinaMcpb {
  foreach ($candidate in @(
    $JinaMcpbPath,
    (Join-Path $InstallDir $JinaMcpbName),
    (Join-Path $RootDir $JinaMcpbName),
    (Join-Path $RootDir "dist\$JinaMcpbName")
  )) {
    if (Test-Path $candidate) {
      $script:JinaMcpbPath = $candidate
      return $true
    }
  }
  return $false
}

function Stage-JinaMcpb {
  if (-not (Find-JinaMcpb)) { return $false }
  $staged = Join-Path $InstallDir $JinaMcpbName
  if ($JinaMcpbPath -ne $staged) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Force $JinaMcpbPath $staged
    $script:JinaMcpbPath = $staged
    Write-Ok "Staged Jina connector at $JinaMcpbPath"
  }
  return $true
}

function Ensure-JinaMcpb {
  if ($SkipJina -eq "1") {
    Write-Log "Skipping Jina connector (DCOS_SKIP_JINA=1)"
    return
  }
  if (Find-JinaMcpb) {
    Write-Ok "Using existing $JinaMcpbPath"
    Stage-JinaMcpb | Out-Null
    $script:JinaInstalled = $true
    return
  }
  if (Download-JinaMcpb) {
    $script:JinaInstalled = $true
    return
  }
  $build = Join-Path $RootDir "scripts\build-jina-mcpb.sh"
  if ($RootDir -and (Test-Path $build) -and (Test-Path (Join-Path $RootDir "extensions\jina\manifest.json"))) {
    Write-Log "Building Jina .mcpb locally…"
    bash $build
    $script:JinaMcpbPath = Join-Path $RootDir "dist\$JinaMcpbName"
    Stage-JinaMcpb | Out-Null
    $script:JinaInstalled = $true
    Write-Ok "Built $JinaMcpbPath"
    return
  }
  Write-Warn "Jina connector not installed — web research will be unavailable until you install jina.mcpb"
  Write-Host "  Download: https://digital-chief-of-staff-releases.vercel.app/"
}

function Setup-JinaApiKey {
  if ($SkipJina -eq "1") { return }
  $envSh = Join-Path $InstallDir "env.sh"
  if (-not (Test-Path $envSh)) { return }
  $content = Get-Content $envSh -Raw
  if ($content -match 'export JINA_API_KEY="([^"]+)"' -and $Matches[1] -and $Matches[1] -ne "YOUR_JINA_API_KEY") {
    Write-Ok "Jina API key already in env.sh"
    return
  }
  Write-Host ""
  Write-Log "Jina web research (morning briefs use this for news and trigger events)"
  Write-Host "  Free API key: https://jina.ai"
  $jinaKey = Read-Host "Paste Jina API key (or Enter to skip)"
  if ([string]::IsNullOrWhiteSpace($jinaKey)) {
    Write-Warn "Skipped Jina API key — add export JINA_API_KEY=`"jina_...`" to $envSh later"
    return
  }
  if ($content -match 'export JINA_API_KEY=') {
    $content = $content -replace 'export JINA_API_KEY="[^"]*"', "export JINA_API_KEY=`"$jinaKey`""
  } else {
    $content += "`nexport JINA_API_KEY=`"$jinaKey`"`n"
  }
  Set-Content -Path $envSh -Value $content -Encoding UTF8
  Write-Ok "Saved JINA_API_KEY to $envSh"
}

function Seed-ClaudeExtension {
  $envFile = Join-Path $InstallDir "env.ps1"
  $envSh = Join-Path $InstallDir "env.sh"
  if (-not (Test-Path $envFile) -and -not (Test-Path $envSh)) { return }
  Write-Log "Enabling Claude extensions (credentials from ~/.config/dcos/env.sh)…"
  $env:DCOS_ROOT_DIR = $RootDir
  node (Join-Path $RootDir "scripts\seed-claude-extension-config.mjs")
  if ($SkipJina -ne "1" -and (Test-Path (Join-Path $RootDir "scripts\seed-claude-jina-extension.mjs"))) {
    node (Join-Path $RootDir "scripts\seed-claude-jina-extension.mjs")
  }
  Write-Ok "Claude extension settings updated"
}

function Open-InClaude {
  if (-not (Test-Path $McpbPath)) { Write-Err "Missing $McpbPath" }
  Write-Host ""
  Write-Log "Step 2/3 — Claude Desktop extensions"
  Write-Log "Install Digital Chief of Staff first; Jina comes after you confirm."
  Start-Process $McpbPath
  Write-Ok "Opening Digital Chief of Staff .mcpb — confirm install in Claude Desktop"
  if ($env:DCOS_SKIP_MCPB_PAUSE -ne "1") {
    Read-Host "Press Enter when Digital Chief of Staff is installed"
  } else {
    Start-Sleep -Seconds 20
  }
  if ($SkipJina -ne "1" -and (Test-Path $JinaMcpbPath)) {
    Write-Log "Now install Jina (web research connector)"
    Start-Process $JinaMcpbPath
    Write-Ok "Opening Jina .mcpb — confirm install in Claude Desktop"
    if ($env:DCOS_SKIP_MCPB_PAUSE -ne "1") {
      Read-Host "Press Enter when Jina is installed"
    }
  } elseif ($SkipJina -ne "1") {
    Write-Warn "Skipping Jina install dialog — jina.mcpb not found"
  }
}

function Stage-UserHelpers {
  Ensure-RootDir
  $stage = Join-Path $RootDir "scripts\stage-dcos-launchers.sh"
  if (Test-Path $stage) {
    if (Get-Command bash -ErrorAction SilentlyContinue) {
      bash $stage $InstallDir $RootDir
    }
  }
}

function Setup-Salesforce {
  if ($SkipSf -eq "1") { Write-Log "Skipping Salesforce (DCOS_SKIP_SALESFORCE=1)"; return }
  Write-Host ""
  Write-Log "Step 3/4 — Salesforce browser login"
  $answer = Read-Host "Connect Salesforce now (browser login)? [Y/n]"
  if ($answer -match '^[Nn]') {
    Write-Warn "Skip for now — double-click 'Login to Salesforce.bat' when ready"
    return
  }
  Ensure-RootDir
  & (Join-Path $RootDir "scripts\salesforce-login.ps1")
}

function Enable-SfdcSyncSchedule {
  if ($SkipSf -eq "1") { return }
  Ensure-RootDir
  $enableScript = Join-Path $RootDir "scripts\enable-sfdc-sync-schedule.ps1"
  if (-not (Test-Path $enableScript)) { return }
  Write-Host ""
  Write-Log "Step 4/5 — Background SFDC sync (every 15 minutes)"
  $answer = Read-Host "Enable automatic Salesforce → Elasticsearch sync? [Y/n]"
  if ($answer -match '^[Nn]') {
    Write-Warn "Skip for now — run scripts\enable-sfdc-sync-schedule.ps1 when ready"
    return
  }
  $env:DCOS_ROOT_DIR = $RootDir
  & $enableScript
}

function Setup-MeddpiccCoachSkill {
  if ($env:DCOS_SKIP_MEDDPICC_COACH -eq "1") {
    Write-Log "Skipping MEDDPICC Coach skill (DCOS_SKIP_MEDDPICC_COACH=1)"
    return
  }
  Ensure-RootDir
  $script = Join-Path $RootDir "scripts\install-meddpicc-coach-skill.ps1"
  if (-not (Test-Path $script)) { return }
  Write-Host ""
  Write-Log "Step 5/5 — MEDDPICC Coach skill (Claude training module)"
  $answer = Read-Host "Install MEDDPICC Coach skill for Claude Desktop? [Y/n]"
  if ($answer -match '^[Nn]') {
    Write-Warn "Skip for now — run scripts\install-meddpicc-coach-skill.ps1 when ready"
    return
  }
  $env:DCOS_ROOT_DIR = $RootDir
  & $script
}

function Print-NextSteps {
  Write-Host ""
  Write-Host "Install complete" -ForegroundColor White
  $jinaNote = ""
  if ($SkipJina -ne "1" -and -not $script:JinaInstalled) {
    $jinaNote = "  ! Jina missing: download jina.mcpb from https://digital-chief-of-staff-releases.vercel.app/`n"
  }
  Write-Host @"

  1. Claude Desktop → confirm **Digital Chief of Staff** first, then **Jina** (installer waits between dialogs)
  2. Toggle both on if needed, then restart Claude Desktop once
  3. Connectors → Desktop should list digital-chief-of-staff + Jina (not Directory search)
  4. Helpers in **$InstallDir** — Refresh Google Auth.command, Ensure DCOS Ready.command (see README-helpers.txt)
  4b. BigQuery auth: **$InstallDir\Refresh Google Auth.command** or `gcloud auth application-default login`
$jinaNote  5. Claude chat → "Run dcos_sfdc_auth_status" then morning brief
  6. Claude Desktop → Settings → Capabilities → Skills → upload **$InstallDir\meddpicc-coach.skill** → toggle ON

  Config: $InstallDir
  Docs:   https://github.com/$Repo/blob/main/docs/INSTALL.md

  No Docker or Kubernetes required — Elasticsearch runs natively on this PC.

"@
}

Write-Host ""
Write-Host "  Digital Chief of Staff — single installer (Windows)"
Write-Host "  ───────────────────────────────────────────────────"
Write-Host ""
Write-Host "  Installs: Elasticsearch + Claude extensions (DCOS + Jina) + Salesforce login + MEDDPICC Coach skill"
Write-Host "  Requires: Node.js 18+, Claude Desktop"
Write-Host ""

Ensure-RootDir
Bootstrap-Config
Ensure-Node
Setup-JinaApiKey
Setup-UserProfile
Setup-Elasticsearch
Ensure-Mcpb
Ensure-JinaMcpb
Stage-UserHelpers
Seed-ClaudeExtension
Open-InClaude
Start-Sleep -Seconds 3
Seed-ClaudeExtension
Setup-Salesforce
Enable-SfdcSyncSchedule
Setup-MeddpiccCoachSkill
Stage-UserHelpers
Print-NextSteps
