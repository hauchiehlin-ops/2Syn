param(
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release",
  [ValidateSet("x64")]
  [string]$Platform = "x64"
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
  throw "Run this script from an elevated PowerShell session."
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DriverDir = Join-Path $RepoRoot "drivers\windows-vhid\$Platform\$Configuration"
$Inf = Join-Path $DriverDir "2synvhid.inf"

if (-not (Test-Path $Inf)) {
  throw "Built driver INF not found: $Inf. Run scripts\build-windows-vhid.ps1 first."
}

pnputil /add-driver $Inf /install
if ($LASTEXITCODE -ne 0) {
  throw "pnputil failed with exit code $LASTEXITCODE"
}

Write-Host "2syn virtual HID driver install requested. Reboot if Device Manager does not show the device immediately."

