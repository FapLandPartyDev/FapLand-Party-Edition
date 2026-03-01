[CmdletBinding()]
param(
  [ValidateSet("dev", "prod")]
  [string]$Mode,
  [string]$ProjectDir = "C:\f-land"
)

$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $ProjectDir ".vagrant-win"
$logsDir = Join-Path $runtimeDir "logs"
$prodDir = Join-Path $runtimeDir "prod"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Stop-FapLandProcess {
  Get-CimInstance Win32_Process |
    Where-Object {
      ($_.Name -in @("electron.exe", "Fap Land.exe", "node.exe")) -and
      ($_.CommandLine -like "*f-land*" -or $_.CommandLine -like "*Fap Land*")
    } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      } catch {
        Write-Warning "Failed to stop process $($_.ProcessId): $($_.Exception.Message)"
      }
    }
}

function Start-LoggedProcess {
  param(
    [string]$FilePath,
    [string]$Arguments,
    [string]$OutLog,
    [string]$ErrLog
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $ProjectDir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($psi)
  Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -Action {
    if ($EventArgs.Data) {
      Add-Content -Path $Event.MessageData.OutLog -Value $EventArgs.Data
    }
  } -MessageData @{ OutLog = $OutLog } | Out-Null
  Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -Action {
    if ($EventArgs.Data) {
      Add-Content -Path $Event.MessageData.ErrLog -Value $EventArgs.Data
    }
  } -MessageData @{ ErrLog = $ErrLog } | Out-Null
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()
  Wait-Process -Id $process.Id
}

Stop-FapLandProcess

if ($Mode -eq "dev") {
  $env:FLAND_ENABLE_DEV_FEATURES = "true"
  $env:FLAND_USER_DATA_SUFFIX = "vagrant-dev"
  $env:FLAND_REMOTE_DEBUGGING_PORT = "9222"
  $env:FLAND_STARTUP_SAFE_MODE = ""

  Start-LoggedProcess `
    -FilePath "npm.cmd" `
    -Arguments "run dev" `
    -OutLog (Join-Path $logsDir "dev.out.log") `
    -ErrLog (Join-Path $logsDir "dev.err.log")
  exit
}

$env:FLAND_USER_DATA_SUFFIX = "vagrant-prod"
$portableDir = Join-Path $prodDir "portable"
$exePath = Join-Path $portableDir "Fap Land.exe"

if (-not (Test-Path $exePath)) {
  throw "Packaged executable not found at $exePath. Run vagrant provision fapland-win-prod first."
}

Start-Process -FilePath $exePath -WorkingDirectory $portableDir
