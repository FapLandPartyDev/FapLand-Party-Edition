[CmdletBinding()]
param(
  [string]$ProjectDir = "C:\f-land",
  [string]$DevPort = "3000",
  [string]$RemoteDebuggingPort = "9222"
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[fapland dev] $Message"
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

Write-Step "Stopping old dev processes"
Stop-FapLandProcess

Write-Step "Ensuring runtime directories exist"
$runtimeDir = Join-Path $ProjectDir ".vagrant-win"
$logsDir = Join-Path $runtimeDir "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

if (-not (Test-Path (Join-Path $ProjectDir "node_modules"))) {
  Write-Step "Installing npm dependencies"
  Invoke-External -FilePath "npm.cmd" -Arguments @("ci")
}

Write-Step "Writing dev environment file"
$envFile = Join-Path $runtimeDir "fapland.env.ps1"
$envContent = @"
`$env:FLAND_ENABLE_DEV_FEATURES = "true"
`$env:FLAND_USER_DATA_SUFFIX = "vagrant-dev"
`$env:FLAND_REMOTE_DEBUGGING_PORT = "$RemoteDebuggingPort"
`$env:FLAND_WIN_DEV_PORT = "$DevPort"
"@
Set-Content -Path $envFile -Value $envContent -Encoding UTF8

Write-Step "Creating FapLandDev scheduled task"
$taskName = "FapLandDev"
$scriptPath = Join-Path $ProjectDir "vagrant\windows\start-fapland.ps1"
$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Mode dev -ProjectDir `"$ProjectDir`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument -WorkingDirectory $ProjectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "vagrant"
$principal = New-ScheduledTaskPrincipal -UserId "vagrant" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null

Write-Step "Dev startup task is ready. RDP into the VM to start the interactive app session."
