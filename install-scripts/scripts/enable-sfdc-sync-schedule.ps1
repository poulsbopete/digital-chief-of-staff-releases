# Enable background Salesforce → Elasticsearch sync every 15 minutes (Windows Task Scheduler).
$ErrorActionPreference = "Stop"

$InstallDir = if ($env:DCOS_INSTALL_DIR) { $env:DCOS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".config\dcos" }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = if ($env:DCOS_ROOT_DIR) { $env:DCOS_ROOT_DIR } else { Split-Path -Parent $ScriptDir }
$SyncScript = Join-Path $RootDir "scripts\sfdc-sync.mjs"
if (-not (Test-Path $SyncScript)) {
  $SyncScript = Join-Path $InstallDir "vendor\digital-chief-of-staff\scripts\sfdc-sync.mjs"
}
if (-not (Test-Path $SyncScript)) {
  Write-Warning "sfdc-sync.mjs not found — run install.ps1 first"
  exit 1
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  Write-Warning "node not on PATH"
  exit 1
}

$TaskName = "DigitalChiefOfStaff-SfdcSync"
$LogDir = Join-Path $InstallDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Wrapper = Join-Path $InstallDir "run-sfdc-sync.cmd"
$cmd = "@echo off`r`n`"$Node`" `"$SyncScript`" >> `"$LogDir\sfdc-sync.log`" 2>&1`r`n"
Set-Content -Path $Wrapper -Value $cmd -Encoding ASCII

schtasks /Create /F /TN $TaskName /TR "`"$Wrapper`"" /SC MINUTE /MO 15 /RL LIMITED | Out-Null

Write-Host "→ Running initial Salesforce sync…" -ForegroundColor Cyan
& $Node $SyncScript
Write-Host "✓ Background SFDC sync enabled (every 15 minutes)" -ForegroundColor Green
Write-Host "  Task: $TaskName"
Write-Host "  Logs: $LogDir\sfdc-sync.log"
