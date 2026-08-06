param(
  [ValidateSet("host", "client")]
  [string]$Target = "host",
  [ValidateSet("Release", "Debug")]
  [string]$Configuration = "Release",
  [ValidateSet("x64")]
  [string]$Platform = "x64",
  [string]$DriverCertificateThumbprint = "",
  [string]$SignedDriverCatalogPath = "",
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  [switch]$SkipPull,
  [switch]$AllowUnsignedDriverPackage
)

$ErrorActionPreference = "Stop"

function Assert-Windows {
  if (-not $IsWindows -and $env:OS -ne "Windows_NT") {
    throw "This release packaging script must run on Windows with Visual Studio, WDK, Rust, and Node.js installed."
  }
}

function Run([string]$Command, [string[]]$Arguments) {
  Write-Host "`n> $Command $($Arguments -join ' ')" -ForegroundColor Cyan
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
  }
}

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

function Find-WindowsSdkTool([string]$ToolName) {
  $roots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "${env:ProgramFiles}\Windows Kits\10\bin"
  )

  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $candidate = Get-ChildItem -Path $root -Filter $ToolName -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\$([regex]::Escape($ToolName))$" } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }

  return $null
}

function Sign-DriverCatalog([string]$CatalogPath) {
  if ($DriverCertificateThumbprint.Trim().Length -eq 0) {
    if ($AllowUnsignedDriverPackage) {
      Write-Host "Skipping driver signing because -AllowUnsignedDriverPackage was supplied." -ForegroundColor Yellow
      return
    }
    throw "Formal Windows packages require a signed driver catalog. Pass -DriverCertificateThumbprint <thumbprint>, or use -AllowUnsignedDriverPackage only for internal test packages."
  }

  $signtool = Find-WindowsSdkTool "signtool.exe"
  if (-not $signtool) {
    throw "signtool.exe not found. Install Windows SDK/WDK."
  }

  Run $signtool @(
    "sign",
    "/fd", "SHA256",
    "/tr", $TimestampUrl,
    "/td", "SHA256",
    "/sha1", $DriverCertificateThumbprint,
    $CatalogPath
  )
}

function Write-ReleaseInstallScript([string]$OutputPath) {
  $content = @'
param(
  [switch]$SkipAppInstaller
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
  throw "Run this script from an elevated PowerShell session."
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DriverInf = Join-Path $Root "driver\2synvhid.inf"
$Installer = Get-ChildItem (Join-Path $Root "installer") -Include *.exe,*.msi -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not (Test-Path $DriverInf)) {
  throw "Driver INF not found: $DriverInf"
}

Write-Host "Installing 2syn virtual HID driver..."
pnputil /add-driver $DriverInf /install
if ($LASTEXITCODE -ne 0) {
  throw "pnputil failed with exit code $LASTEXITCODE"
}

if (-not $SkipAppInstaller) {
  if (-not $Installer) {
    throw "No app installer found under installer\"
  }

  Write-Host "Installing app: $($Installer.FullName)"
  if ($Installer.Extension -ieq ".msi") {
    Start-Process "msiexec.exe" -ArgumentList @("/i", "`"$($Installer.FullName)`"", "/qn", "/norestart") -Wait
  } else {
    Start-Process $Installer.FullName -ArgumentList "/S" -Wait
  }
}

Write-Host "2syn Windows host package installed."
'@

  Set-Content -Path $OutputPath -Value $content -Encoding UTF8
}

Assert-Windows

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RepoRoot

$PackageJson = Get-Content "desktop\package.json" | ConvertFrom-Json
$Version = $PackageJson.version
$ReleaseRoot = Join-Path $RepoRoot "release"
$ReleaseDir = Join-Path $ReleaseRoot ("2syn-windows-{0}-{1}" -f $Target, $Version)

Write-Host "2syn Windows one-command release package" -ForegroundColor Green
Write-Host "Repo: $RepoRoot"
Write-Host "Target: $Target"
Write-Host "Version: $Version"
Write-Host "Release dir: $ReleaseDir"

if (-not $SkipPull) {
  $dirty = git status --porcelain
  if ($dirty) {
    Write-Host "Working tree is not clean. For official release, commit/stash changes or rerun with -SkipPull for local packaging." -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host $_ }
    exit 1
  }
  Run "git" @("fetch", "origin", "--tags", "--force")
  Run "git" @("checkout", "main")
  Run "git" @("pull", "--ff-only")
}

Write-Host "`nBuilding virtual HID driver..." -ForegroundColor Green
Run "powershell.exe" @(
  "-ExecutionPolicy", "Bypass",
  "-File", (Join-Path $ScriptDir "build-windows-vhid.ps1"),
  "-Configuration", $Configuration,
  "-Platform", $Platform
)

$DriverBuildDir = Join-Path $RepoRoot "drivers\windows-vhid"
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
if ($SignedDriverCatalogPath.Trim().Length -gt 0) {
  if (-not (Test-Path $SignedDriverCatalogPath)) {
    throw "Signed driver catalog not found: $SignedDriverCatalogPath"
  }
  if (-not $DriverCat) {
    $DriverCat = [pscustomobject]@{ FullName = (Join-Path (Split-Path -Parent $DriverSys.FullName) "2synvhid.cat") }
  }
  Copy-Item $SignedDriverCatalogPath $DriverCat.FullName -Force
  Write-Host "Using supplied signed driver catalog: $SignedDriverCatalogPath" -ForegroundColor Green
} elseif ($DriverCat) {
  Sign-DriverCatalog $DriverCat.FullName
} elseif (-not $AllowUnsignedDriverPackage) {
  throw "Driver catalog 2synvhid.cat was not found. A formal package requires a signed catalog."
}

Write-Host "`nBuilding Tauri app bundle..." -ForegroundColor Green
Run "powershell.exe" @(
  "-ExecutionPolicy", "Bypass",
  "-File", (Join-Path $ScriptDir "build-windows-clean.ps1"),
  "-Target", $Target,
  "-SkipPull"
)

$Installer = Find-LatestFile @(
  (Join-Path $RepoRoot "target\release\bundle\nsis\*.exe"),
  (Join-Path $RepoRoot "target\release\bundle\msi\*.msi"),
  (Join-Path $RepoRoot "desktop\src-tauri\target\release\bundle\nsis\*.exe"),
  (Join-Path $RepoRoot "desktop\src-tauri\target\release\bundle\msi\*.msi")
)
if (-not $Installer) {
  throw "No Tauri installer was found under target release bundle directories."
}

Write-Host "`nStaging release package..." -ForegroundColor Green
Remove-Item -Recurse -Force $ReleaseDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $ReleaseDir "installer") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $ReleaseDir "driver") | Out-Null

Copy-Item $Installer.FullName (Join-Path $ReleaseDir "installer") -Force
Copy-Item $DriverInf.FullName (Join-Path $ReleaseDir "driver") -Force
Copy-Item $DriverSys.FullName (Join-Path $ReleaseDir "driver") -Force
if ($DriverCat) {
  Copy-Item $DriverCat.FullName (Join-Path $ReleaseDir "driver") -Force
}
Copy-Item (Join-Path $RepoRoot "drivers\windows-vhid\README.md") (Join-Path $ReleaseDir "driver") -Force
Write-ReleaseInstallScript (Join-Path $ReleaseDir "Install-2syn-Windows-Host.ps1")

$Manifest = [ordered]@{
  product = "2syn"
  target = $Target
  version = $Version
  commit = (git rev-parse --short HEAD)
  installer = (Split-Path -Leaf $Installer.FullName)
  driver = @{
    inf = "2synvhid.inf"
    sys = "2synvhid.sys"
    cat = if ($DriverCat) { "2synvhid.cat" } else { $null }
    signed = [bool]($DriverCertificateThumbprint.Trim().Length -gt 0 -or $SignedDriverCatalogPath.Trim().Length -gt 0)
  }
  packagedAt = (Get-Date).ToString("o")
}
$Manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $ReleaseDir "manifest.json") -Encoding UTF8

$ZipPath = Join-Path $ReleaseRoot ("2syn-windows-{0}-{1}.zip" -f $Target, $Version)
Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $ReleaseDir "*") -DestinationPath $ZipPath -Force

Write-Host "`nRelease package ready:" -ForegroundColor Green
Write-Host $ReleaseDir
Write-Host $ZipPath
