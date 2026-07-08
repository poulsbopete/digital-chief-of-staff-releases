# Bootstrap vendor cache on Windows: public install-scripts mirror first.
$ErrorActionPreference = "Stop"

$MirrorRepo = if ($env:DCOS_SCRIPTS_MIRROR_REPO) { $env:DCOS_SCRIPTS_MIRROR_REPO } else { "poulsbopete/digital-chief-of-staff-releases" }
$SourceRepo = if ($env:DCOS_GITHUB_REPO) { $env:DCOS_GITHUB_REPO } else { "elastic/digital-chief-of-staff" }
$Ref = if ($env:DCOS_GITHUB_REF) { $env:DCOS_GITHUB_REF } else { "main" }

function Invoke-FetchInstallAssets($Repo, $Prefix) {
  $env:DCOS_GITHUB_REPO = $Repo
  $env:DCOS_GITHUB_REF = $Ref
  $env:DCOS_RAW_PREFIX = $Prefix
  $uri = "https://raw.githubusercontent.com/$Repo/$Ref/${Prefix}scripts/fetch-install-assets.ps1"
  $tmp = Join-Path $env:TEMP "dcos-fetch-install-assets.ps1"
  Invoke-WebRequest -Uri $uri -OutFile $tmp -UseBasicParsing
  & $tmp
}

try {
  Invoke-FetchInstallAssets $MirrorRepo "install-scripts/"
  exit 0
} catch {}

try {
  Invoke-FetchInstallAssets $SourceRepo ""
  exit 0
} catch {}

Write-Error "Could not download DCOS installer scripts. Use the Windows EXE from https://github.com/$MirrorRepo/releases/latest"
exit 1
