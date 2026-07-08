# Install and start Elasticsearch from official zip — no Docker/Kubernetes.
$ErrorActionPreference = "Stop"

$EsVersion = if ($env:DCOS_ES_VERSION) { $env:DCOS_ES_VERSION } else { "8.17.2" }
$InstallDir = if ($env:DCOS_INSTALL_DIR) { $env:DCOS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".config\dcos" }
$EsBase = if ($env:DCOS_ES_BASE) { $env:DCOS_ES_BASE } else { Join-Path $InstallDir "elasticsearch" }
$EsHome = Join-Path $EsBase "elasticsearch-$EsVersion"
$EsData = Join-Path $EsBase "data"
$EsLogs = Join-Path $EsBase "logs"
$EsConfig = Join-Path $EsHome "config"
$EsPidFile = Join-Path $EsBase "elasticsearch.pid"
$EsPasswordFile = Join-Path $EsBase "elastic.password"
$EsUrl = if ($env:ELASTICSEARCH_URL) { $env:ELASTICSEARCH_URL.TrimEnd("/") } else { "http://127.0.0.1:9200" }

function Write-Log($msg) { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

function Test-EsResponds {
  try {
    $r = Invoke-WebRequest -Uri "$EsUrl/" -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck
    return $r.StatusCode -in 200, 401
  } catch { return $false }
}

function Install-EsZip {
  $zipName = "elasticsearch-$EsVersion-windows-x86_64.zip"
  $url = "https://artifacts.elastic.co/downloads/elasticsearch/$zipName"
  $cacheDir = Join-Path $EsBase "cache"
  $cache = Join-Path $cacheDir $zipName
  $bin = Join-Path $EsHome "bin\elasticsearch.bat"
  if (Test-Path $bin) {
    Write-Ok "Elasticsearch $EsVersion already installed"
    return
  }
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  if (-not (Test-Path $cache)) {
    Write-Log "Downloading Elasticsearch $EsVersion for Windows (~600 MB, one-time)…"
    Invoke-WebRequest -Uri $url -OutFile $cache -UseBasicParsing
  }
  Write-Log "Extracting Elasticsearch…"
  New-Item -ItemType Directory -Force -Path $EsBase | Out-Null
  Expand-Archive -Path $cache -DestinationPath $EsBase -Force
  Write-Ok "Installed to $EsHome"
}

function Write-EsConfig {
  New-Item -ItemType Directory -Force -Path $EsData, $EsLogs | Out-Null
  $cfg = Join-Path $EsHome "config"
  if (-not (Test-Path $cfg)) { Write-Err "Missing $cfg — delete $EsBase and re-run install" }
  $legacy = Join-Path $EsBase "config"
  if ((Test-Path $legacy) -and ($legacy -ne $cfg)) {
    Write-Warn "Removing incomplete legacy config at $legacy"
    Remove-Item -Recurse -Force $legacy
  }
  $yml = @"
cluster.name: dcos-local
node.name: dcos-es01
discovery.type: single-node
network.host: 127.0.0.1
http.port: 9200
xpack.security.enabled: true
xpack.security.http.ssl.enabled: false
path.data: $($EsData -replace '\\', '/')
path.logs: $($EsLogs -replace '\\', '/')
"@
  Set-Content -Path (Join-Path $cfg "elasticsearch.yml") -Value $yml -Encoding UTF8
}

function Wait-ForEs {
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    if (Test-EsResponds) { return }
    Start-Sleep -Seconds 2
  }
  Write-Err "Elasticsearch did not respond on $EsUrl. Logs: $EsLogs"
}

function Read-PasswordFromLogs {
  $deadline = (Get-Date).AddMinutes(2)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $EsLogs) {
      Get-ChildItem $EsLogs -Filter *.log -ErrorAction SilentlyContinue | ForEach-Object {
        $line = Select-String -Path $_.FullName -Pattern "Password for the elastic user" -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($line) {
          $parts = $line.Line.Trim() -split '\s+'
          return $parts[-1]
        }
      }
    }
    Start-Sleep -Seconds 2
  }
  return $null
}

function Ensure-ElasticPassword {
  if (Test-Path $EsPasswordFile) {
    $env:DCOS_ELASTIC_PASSWORD = Get-Content $EsPasswordFile -Raw
    return
  }
  if ($env:DCOS_ELASTIC_PASSWORD) {
    Set-Content -Path $EsPasswordFile -Value $env:DCOS_ELASTIC_PASSWORD -NoNewline
    return
  }
  Write-Log "Waiting for Elasticsearch bootstrap credentials…"
  $pass = Read-PasswordFromLogs
  if (-not $pass) {
    Write-Warn "Resetting elastic password…"
    $reset = & (Join-Path $EsHome "bin\elasticsearch-reset-password.bat") -u elastic -b --url $EsUrl 2>&1 | Out-String
    if ($reset -match 'New value:\s*(\S+)') { $pass = $Matches[1] }
  }
  if (-not $pass) { Write-Err "Could not determine elastic password. Check $EsLogs" }
  Set-Content -Path $EsPasswordFile -Value $pass -NoNewline
  $env:DCOS_ELASTIC_PASSWORD = $pass
  Write-Ok "Saved elastic user password"
}

function Start-NativeEs {
  if (Test-EsResponds) {
    Write-Ok "Elasticsearch already responding at $EsUrl"
    return
  }
  Install-EsZip
  Write-EsConfig
  Write-Log "Starting Elasticsearch (native, background)…"
  $env:ES_JAVA_OPTS = if ($env:ES_JAVA_OPTS) { $env:ES_JAVA_OPTS } else { "-Xms512m -Xmx512m" }
  $bat = Join-Path $EsHome "bin\elasticsearch.bat"
  Start-Process -FilePath $bat -ArgumentList @("-d", "-p", "`"$EsPidFile`"") -WorkingDirectory $EsHome -WindowStyle Hidden
  Wait-ForEs
  Write-Ok "Elasticsearch running at $EsUrl"
}

Start-NativeEs
Ensure-ElasticPassword
