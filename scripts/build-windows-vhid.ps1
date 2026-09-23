param(
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release",
  [ValidateSet("x64")]
  [string]$Platform = "x64"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $RepoRoot "drivers\windows-vhid\2synvhid.vcxproj"

if (-not (Test-Path $Project)) {
  throw "Driver project not found: $Project"
}

# 用 vswhere 找 MSBuild，支援任何 VS 版本（2022/2026）與版次（Community/Professional/Enterprise/BuildTools）；
# 寫死路徑在非 2022 Community/BuildTools 的機器上會找不到。
$msbuild = $null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
  $msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe" |
    Select-Object -First 1
}
if (-not $msbuild) {
  $cmd = Get-Command msbuild.exe -ErrorAction SilentlyContinue
  if ($cmd) { $msbuild = $cmd.Source }
}
if (-not $msbuild -or -not (Test-Path $msbuild)) {
  throw "MSBuild not found. Install Visual Studio (or Build Tools) with the Windows Driver Kit."
}
Write-Host "Using MSBuild: $msbuild"

& $msbuild $Project /p:Configuration=$Configuration /p:Platform=$Platform
if ($LASTEXITCODE -ne 0) {
  throw "Driver build failed with exit code $LASTEXITCODE"
}

