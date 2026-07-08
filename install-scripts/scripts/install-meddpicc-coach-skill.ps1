# Install MEDDPICC Coach skill for Claude Desktop + Claude Code (Windows)
$ErrorActionPreference = "Stop"

$Root = if ($env:DCOS_ROOT_DIR) { $env:DCOS_ROOT_DIR } else { Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$InstallDir = if ($env:DCOS_INSTALL_DIR) { $env:DCOS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".config\dcos" }
$Src = Join-Path $Root "skills\meddpicc-coach"
$Dest = Join-Path $InstallDir "skills\meddpicc-coach"
$SkillZip = Join-Path $InstallDir "meddpicc-coach.skill"
$ClaudeSkills = Join-Path $env:USERPROFILE ".claude\skills"

function Write-Log($m) { Write-Host "→ $m" -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }

if (-not (Test-Path (Join-Path $Src "SKILL.md"))) {
  Write-Warn "MEDDPICC Coach skill not found at $Src — skip"
  exit 0
}

Write-Log "Installing MEDDPICC Coach skill…"
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "skills") | Out-Null
New-Item -ItemType Directory -Force -Path $ClaudeSkills | Out-Null
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
Copy-Item -Recurse $Src $Dest
Write-Ok "Copied skill to $Dest"

$DistZip = Join-Path $Root "dist\meddpicc-coach.skill"
& bash (Join-Path $Root "scripts\build-meddpicc-coach-skill.sh") 2>$null
if (Test-Path $DistZip) {
  Copy-Item -Force $DistZip $SkillZip
  Write-Ok "Packaged $SkillZip"
} else {
  Compress-Archive -Path $Dest -DestinationPath $SkillZip -Force
  Write-Ok "Packaged $SkillZip (Compress-Archive fallback)"
}

$Link = Join-Path $ClaudeSkills "meddpicc-coach"
if (Test-Path $Link) { Remove-Item -Force $Link -ErrorAction SilentlyContinue }
New-Item -ItemType Junction -Path $Link -Target $Dest -ErrorAction SilentlyContinue | Out-Null
if (-not (Test-Path $Link)) {
  cmd /c mklink /J "$Link" "$Dest" 2>$null | Out-Null
}
Write-Ok "Linked Claude Code skill → $Link"

Write-Host @"

MEDDPICC Coach — enable in Claude Desktop

  Claude Desktop → Settings → Capabilities → Skills → Upload skill
  Select: $SkillZip
  Toggle meddpicc-coach ON

  Try: "Score my [Account] deal using MEDDPICC" or "Open the pipeline app"

"@

if (Test-Path $SkillZip) {
  explorer.exe /select,$SkillZip
}
