param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [Parameter(Mandatory = $true)]
  [string[]]$HeroPaths,

  [string[]]$TorrentPaths = @(),

  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$resolvedHeroes = $HeroPaths | ForEach-Object { (Resolve-Path -LiteralPath $_).Path }
$resolvedTorrents = $TorrentPaths | ForEach-Object { (Resolve-Path -LiteralPath $_).Path }
$resolvedFiles = @($resolvedHeroes) + @($resolvedTorrents)
$smokeLog = Join-Path ([System.IO.Path]::GetTempPath()) ("f-land-open-file-smoke-{0}.log" -f [guid]::NewGuid())
$env:FLAND_OPEN_FILE_SMOKE_LOG = $smokeLog
$primary = $null

try {
  $primary = Start-Process -FilePath $resolvedExecutable -PassThru
  Start-Sleep -Seconds 5

  foreach ($filePath in $resolvedFiles) {
    Start-Process -FilePath $filePath
  }

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    $delivered = if (Test-Path -LiteralPath $smokeLog) {
      Get-Content -LiteralPath $smokeLog -Raw
    } else {
      ""
    }
    $allDelivered = $true
    foreach ($filePath in $resolvedFiles) {
      if (-not $delivered.Contains(('"{0}"' -f $filePath.Replace('\', '\\')))) {
        $allDelivered = $false
        break
      }
    }
  } while (-not $allDelivered -and [DateTime]::UtcNow -lt $deadline)

  if (-not $allDelivered) {
    throw "Not every .hero/.torrent file reached the first renderer before timeout."
  }

  $usableInstances = Get-Process | Where-Object {
    try { $_.Path -eq $resolvedExecutable } catch { $false }
  }
  if (@($usableInstances).Count -ne 1) {
    throw "Expected one usable packaged instance, found $(@($usableInstances).Count)."
  }

  Write-Host "PASS: all .hero/.torrent files reached the first instance and only one usable instance remains."
} finally {
  if ($primary -and -not $primary.HasExited) {
    Stop-Process -Id $primary.Id -Force
  }
  Remove-Item -LiteralPath $smokeLog -Force -ErrorAction SilentlyContinue
  Remove-Item Env:FLAND_OPEN_FILE_SMOKE_LOG -ErrorAction SilentlyContinue
}
