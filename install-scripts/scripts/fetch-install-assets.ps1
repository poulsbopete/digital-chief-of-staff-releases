# Download scripts and index mappings when install.ps1 runs without a repo clone.
$ErrorActionPreference = "Stop"

$Repo = if ($env:DCOS_GITHUB_REPO) { $env:DCOS_GITHUB_REPO } else { "elastic/digital-chief-of-staff" }
$MirrorRepo = if ($env:DCOS_SCRIPTS_MIRROR_REPO) { $env:DCOS_SCRIPTS_MIRROR_REPO } else { "poulsbopete/digital-chief-of-staff-releases" }
$Ref = if ($env:DCOS_GITHUB_REF) { $env:DCOS_GITHUB_REF } else { "main" }
$Prefix = if ($env:DCOS_RAW_PREFIX) { $env:DCOS_RAW_PREFIX } else { "" }
$Raw = "https://raw.githubusercontent.com/$Repo/$Ref/$Prefix"
$InstallDir = if ($env:DCOS_INSTALL_DIR) { $env:DCOS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".config\dcos" }
$VendorDir = if ($env:DCOS_VENDOR_DIR) { $env:DCOS_VENDOR_DIR } else { Join-Path $InstallDir "vendor\digital-chief-of-staff" }($msg) { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✓ $msg" -ForegroundColor Green }

$files = @(
  "scripts/setup-local-elasticsearch.ps1",
  "scripts/install-native-elasticsearch.ps1",
  "scripts/ensure-node.sh",
  "scripts/seed-claude-extension-config.mjs",
  "scripts/seed-claude-jina-extension.mjs",
  "scripts/build-jina-mcpb.sh",
  "extensions/jina/manifest.json",
  "extensions/jina/server/run-jina-mcp.mjs",
  "extensions/jina/server/package.json",
  "scripts/install-jina-extension.sh",
  "extensions/digital-chief-of-staff/manifest.json",
  "scripts/setup-user-profile.mjs",
  "scripts/create-local-es-api-key.mjs",
  "lib/load-dcos-env.mjs",
  "lib/dcos-profile.mjs",
  "config/personas.yaml",
  "scripts/init-dcos-indices.mjs",
  "scripts/salesforce-login.ps1",
  "scripts/enable-sfdc-sync-schedule.ps1",
  "scripts/enable-sfdc-sync-schedule.sh",
  "scripts/dcos-elasticsearchctl.ps1",
  "docker/dcos-notes-index.json",
  "docker/dcos-opportunities-index.json",
  "docker/dcos-signals-index.json",
  "docker/dcos-activities-index.json"
)

  Write-Log "Downloading installer components from GitHub ($Repo/$Ref/$Prefix)…"
New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null
foreach ($rel in $files) {
  $dest = Join-Path $VendorDir ($rel -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Invoke-WebRequest -Uri "$Raw/$rel" -OutFile $dest -UseBasicParsing
}
Write-Ok "Cached at $VendorDir"
Write-Output $VendorDir
