param(
  [ValidateSet("Release", "Debug")]
  [string]$Configuration = "Release",
  [ValidateSet("x64")]
  [string]$Platform = "x64",
  [switch]$RequireCatalog
)

$ErrorActionPreference = "Stop"

function Find-LatestFile([string[]]$Patterns) {
  $items = @()
  foreach ($pattern in $Patterns) {
    $items += Get-ChildItem $pattern -ErrorAction SilentlyContinue
  }
  if (-not $items -or $items.Count -eq 0) {
    return $null
  }
  return $items | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$DriverBuildDir = Join-Path $RepoRoot "drivers\windows-vhid"
$StageDir = Join-Path $RepoRoot "desktop\src-tauri\windows\driver"

$DriverInf = Find-LatestFile @(
  (Join-Path $DriverBuildDir "$Platform\$Configuration\2synvhid.inf"),
  (Join-Path $DriverBuildDir "$Platform\$Configuration\**\2synvhid.inf"),
  (Join-Path $DriverBuildDir "**\2synvhid.inf")
)
$DriverSys = Find-LatestFile @(
  (Join-Path $DriverBuildDir "$Platform\$Configuration\2synvhid.sys"),
  (Join-Path $DriverBuildDir "$Platform\$Configuration\**\2synvhid.sys"),
  (Join-Path $DriverBuildDir "**\2synvhid.sys")
)
$DriverCat = Find-LatestFile @(
  (Join-Path $DriverBuildDir "$Platform\$Configuration\2synvhid.cat"),
  (Join-Path $DriverBuildDir "$Platform\$Configuration\**\2synvhid.cat"),
  (Join-Path $DriverBuildDir "**\2synvhid.cat")
)

if (-not $DriverInf -or -not $DriverSys) {
  throw "Driver build artifacts were not found. Expected 2synvhid.inf and 2synvhid.sys under drivers\windows-vhid."
}
if ($RequireCatalog -and -not $DriverCat) {
  throw "Driver catalog 2synvhid.cat was not found. Build/sign the driver before creating the integrated installer."
}

New-Item -ItemType Directory -Force $StageDir | Out-Null
Get-ChildItem $StageDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne ".gitignore" } | Remove-Item -Force

Copy-Item $DriverInf.FullName (Join-Path $StageDir "2synvhid.inf") -Force
Copy-Item $DriverSys.FullName (Join-Path $StageDir "2synvhid.sys") -Force
if ($DriverCat) {
  Copy-Item $DriverCat.FullName (Join-Path $StageDir "2synvhid.cat") -Force
}

Write-Host "Staged Windows vhid driver for Tauri NSIS installer:"
Write-Host "  $StageDir"
