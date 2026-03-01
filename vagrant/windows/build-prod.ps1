[CmdletBinding()]
param(
  [string]$ProjectDir = "C:\f-land"
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[fapland prod] $Message"
}

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

function Invoke-External {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  Push-Location $ProjectDir
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Write-Step "Stopping old prod processes"
Stop-FapLandProcess

$runtimeDir = Join-Path $ProjectDir ".vagrant-win"
$logsDir = Join-Path $runtimeDir "logs"
$prodDir = Join-Path $runtimeDir "prod"
$portableDir = Join-Path $prodDir "portable"
New-Item -ItemType Directory -Force -Path $logsDir, $prodDir | Out-Null

Write-Step "Installing npm dependencies"
Invoke-External -FilePath "npm.cmd" -Arguments @("ci")

Write-Step "Building packaged Windows release"
Invoke-External -FilePath "npm.cmd" -Arguments @("run", "build:package")

$releaseDir = Join-Path $ProjectDir "release"
$portableZip = Get-ChildItem -Path $releaseDir -Filter "Fap Land-Portable-*.zip" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $portableZip) {
  throw "No portable Windows zip matching '$releaseDir\Fap Land-Portable-*.zip' was produced."
}

Write-Step "Extracting $($portableZip.FullName)"
if (Test-Path $portableDir) {
  Remove-Item -Path $portableDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
Expand-Archive -Path $portableZip.FullName -DestinationPath $portableDir -Force

$exePath = Join-Path $portableDir "Fap Land.exe"
if (-not (Test-Path $exePath)) {
  $exeCandidate = Get-ChildItem -Path $portableDir -Filter "Fap Land.exe" -Recurse -File |
    Select-Object -First 1
  if ($exeCandidate) {
    $exePath = $exeCandidate.FullName
  }
}

if (-not (Test-Path $exePath)) {
  throw "Extracted portable zip did not contain Fap Land.exe."
}

Write-Step "Creating FapLandProd scheduled task"
$taskName = "FapLandProd"
$scriptPath = Join-Path $ProjectDir "vagrant\windows\start-fapland.ps1"
$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Mode prod -ProjectDir `"$ProjectDir`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument -WorkingDirectory $ProjectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "vagrant"
$principal = New-ScheduledTaskPrincipal -UserId "vagrant" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null

Write-Step "Prod startup task is ready. RDP into the VM to launch $exePath."
