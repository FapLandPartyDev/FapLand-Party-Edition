[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$ProjectDir = "C:\f-land",
  [string]$NodeVersion = "24.11.1",
  [string]$DevPort = "3000",
  [string]$RemoteDebuggingPort = "9222"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
  param([string]$Message)
  Write-Host "[fapland bootstrap] $Message"
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = $ProjectDir
  )

  Write-Step ("Running: {0} {1}" -f $FilePath, ($Arguments -join " "))
  if ($WhatIfPreference) {
    return
  }

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

Write-Step "Configuring TLS 1.2"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Step "Enabling Remote Desktop"
if ($PSCmdlet.ShouldProcess("Windows Remote Desktop", "Enable")) {
  Set-ItemProperty -Path "HKLM:\System\CurrentControlSet\Control\Terminal Server" -Name "fDenyTSConnections" -Value 0
  Enable-NetFirewallRule -DisplayGroup "Remote Desktop" | Out-Null
}

Write-Step "Opening development firewall ports"
if ($PSCmdlet.ShouldProcess("Windows Firewall", "Open Fap Land dev ports")) {
  foreach ($port in @($DevPort, $RemoteDebuggingPort)) {
    $ruleName = "Fap Land Vagrant TCP $port"
    $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existingRule) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port | Out-Null
    }
  }
}

Write-Step "Ensuring Chocolatey is installed"
if (-not (Get-Command choco.exe -ErrorAction SilentlyContinue)) {
  if ($PSCmdlet.ShouldProcess("Chocolatey", "Install")) {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString("https://community.chocolatey.org/install.ps1"))
    Refresh-Path
  }
}

Write-Step "Installing Windows build prerequisites"
$packages = @(
  [pscustomobject]@{ Name = "git"; Arguments = @() },
  [pscustomobject]@{ Name = "7zip"; Arguments = @() },
  [pscustomobject]@{ Name = "nodejs"; Arguments = @("--version=$NodeVersion") },
  [pscustomobject]@{
    Name = "visualstudio2022buildtools"
    Arguments = @("--package-parameters", "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --locale en-US")
  },
  [pscustomobject]@{ Name = "visualstudio2022-workload-vctools"; Arguments = @() }
)

foreach ($package in $packages) {
  $name = $package.Name
  $extraArgs = $package.Arguments
  if ($PSCmdlet.ShouldProcess($name, "Install with Chocolatey")) {
    & choco install $name -y --no-progress @extraArgs
    if ($LASTEXITCODE -ne 0) {
      throw "Chocolatey failed while installing $name with code $LASTEXITCODE"
    }
    Refresh-Path
  }
}

Write-Step "Creating runtime directories"
$runtimeDir = Join-Path $ProjectDir ".vagrant-win"
$logsDir = Join-Path $runtimeDir "logs"
$prodDir = Join-Path $runtimeDir "prod"
foreach ($dir in @($runtimeDir, $logsDir, $prodDir)) {
  if ($PSCmdlet.ShouldProcess($dir, "Create directory")) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
}

Write-Step "Writing helper environment file"
$envFile = Join-Path $runtimeDir "fapland.env.ps1"
$envContent = @"
`$env:FLAND_WIN_PROJECT_DIR = "$ProjectDir"
`$env:FLAND_WIN_DEV_PORT = "$DevPort"
`$env:FLAND_WIN_REMOTE_DEBUGGING_PORT = "$RemoteDebuggingPort"
`$env:FLAND_WIN_NODE_VERSION = "$NodeVersion"
"@
if ($PSCmdlet.ShouldProcess($envFile, "Write environment helper")) {
  Set-Content -Path $envFile -Value $envContent -Encoding UTF8
}

Write-Step "Installing npm dependencies"
Invoke-External -FilePath "npm.cmd" -Arguments @("ci") -WorkingDirectory $ProjectDir

Write-Step "Bootstrap complete"
