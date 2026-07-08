# Start/stop/status for native DCOS Elasticsearch on Windows.
param([ValidateSet("start", "stop", "status")][string]$Command = "status")

$InstallDir = if ($env:DCOS_INSTALL_DIR) { $env:DCOS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".config\dcos" }
$EsVersion = if ($env:DCOS_ES_VERSION) { $env:DCOS_ES_VERSION } else { "8.17.2" }
$EsBase = if ($env:DCOS_ES_BASE) { $env:DCOS_ES_BASE } else { Join-Path $InstallDir "elasticsearch" }
$EsHome = Join-Path $EsBase "elasticsearch-$EsVersion"
$EsConfig = Join-Path $EsBase "config"
$EsPidFile = Join-Path $EsBase "elasticsearch.pid"

function Test-HttpUp {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:9200/" -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch { return $false }
}

switch ($Command) {
  "start" {
    if (Test-HttpUp) { Write-Host "Elasticsearch already responding on http://127.0.0.1:9200"; exit 0 }
    $bat = Join-Path $EsHome "bin\elasticsearch.bat"
    if (-not (Test-Path $bat)) { Write-Error "Elasticsearch not installed. Run Install Digital Chief of Staff.bat"; exit 1 }
    $env:ES_JAVA_OPTS = if ($env:ES_JAVA_OPTS) { $env:ES_JAVA_OPTS } else { "-Xms512m -Xmx512m" }
    Start-Process -FilePath $bat -ArgumentList @("-d", "-p", "`"$EsPidFile`"") -WorkingDirectory $EsHome -WindowStyle Hidden
    Write-Host "Starting… logs: $(Join-Path $EsBase 'logs')"
  }
  "stop" {
    if (Test-Path $EsPidFile) {
      $pid = Get-Content $EsPidFile -Raw
      if ($pid) { Stop-Process -Id $pid.Trim() -Force -ErrorAction SilentlyContinue }
      Remove-Item $EsPidFile -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped Elasticsearch"
    } else {
      Write-Host "Elasticsearch is not running"
    }
  }
  "status" {
    if (Test-HttpUp) { Write-Host "running — http://127.0.0.1:9200" }
    elseif (Test-Path $EsPidFile) { Write-Host "starting (pid $(Get-Content $EsPidFile))" }
    else { Write-Host "stopped" }
  }
}
