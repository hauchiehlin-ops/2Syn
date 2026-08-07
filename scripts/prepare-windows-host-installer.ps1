param(
  [ValidateSet("Release", "Debug")]
  [string]$Configuration = "Release",
  [ValidateSet("x64")]
  [string]$Platform = "x64"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $ScriptDir "build-windows-vhid.ps1") -Configuration $Configuration -Platform $Platform
if ($LASTEXITCODE -ne 0) {
  throw "build-windows-vhid.ps1 failed with exit code $LASTEXITCODE"
}

& (Join-Path $ScriptDir "stage-windows-vhid-for-tauri.ps1") -Configuration $Configuration -Platform $Platform -RequireCatalog
if ($LASTEXITCODE -ne 0) {
  throw "stage-windows-vhid-for-tauri.ps1 failed with exit code $LASTEXITCODE"
}
