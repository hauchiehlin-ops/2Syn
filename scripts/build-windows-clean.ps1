param(
  [ValidateSet("host", "client")]
  [string]$Target = "host",
  [switch]$SkipPull,
  [switch]$DiscardLocalChanges
)

$ErrorActionPreference = "Stop"

$script:BuildLog = $null

function Run([string]$Command, [string[]]$Arguments) {
  Write-Host "`n> $Command $($Arguments -join ' ')" -ForegroundColor Cyan
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Command @Arguments 2>&1 | ForEach-Object {
      $line = "$_"
      Write-Host $line
      Add-Content -Path $script:BuildLog -Value $line
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    if (Test-Path $script:BuildLog) {
      Write-Host "`nLast build log lines:" -ForegroundColor Yellow
      Get-Content $script:BuildLog -Tail 160
      Write-Host "`nFull build log: $script:BuildLog" -ForegroundColor Yellow
    }
    throw "Command failed with exit code ${exitCode}: $Command $($Arguments -join ' ')"
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot
$script:BuildLog = Join-Path $repoRoot ("build-windows-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$env:RUST_BACKTRACE = "1"
$env:CARGO_TERM_COLOR = "always"

Write-Host "2Syn Windows clean build" -ForegroundColor Green
Write-Host "Repository: $repoRoot"
Write-Host "Target: $Target"
Write-Host "Build log: $script:BuildLog"

if (-not $SkipPull) {
  $dirty = git status --porcelain
  if ($dirty) {
    if (-not $DiscardLocalChanges) {
      Write-Host "`nWorking tree is not clean. Please commit/stash/remove local changes first, or rerun with -DiscardLocalChanges:" -ForegroundColor Yellow
      $dirty | ForEach-Object { Write-Host $_ }
      exit 1
    }

    Write-Host "`nDiscarding local changes and untracked files..." -ForegroundColor Yellow
    Run "git" @("reset", "--hard")
    Run "git" @("clean", "-xdf")
  }

  Run "git" @("fetch", "origin", "--tags", "--force")
  Run "git" @("checkout", "main")
  Run "git" @("reset", "--hard", "origin/main")
}

Write-Host "`nBuild source identity:" -ForegroundColor Green
git rev-parse --short HEAD
git describe --tags --always

$packageVersion = (Get-Content "desktop/package.json" | ConvertFrom-Json).version
$tauriConfig = Get-Content "desktop/src-tauri/tauri.conf.json" | ConvertFrom-Json
Write-Host "package.json version: $packageVersion"
Write-Host "tauri.conf.json version: $($tauriConfig.version)"

Write-Host "`nCleaning generated build artifacts..." -ForegroundColor Green
Remove-Item -Recurse -Force "target" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "desktop/dist" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "desktop/src-tauri/target" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "desktop/node_modules" -ErrorAction SilentlyContinue

Set-Location (Join-Path $repoRoot "desktop")
Run "npm" @("install")

if ($Target -eq "client") {
  Run "npm" @("run", "tauri:build:client")
} else {
  Run "npm" @("run", "tauri:build:host")
}

Set-Location $repoRoot

Write-Host "`nGenerated Windows bundles:" -ForegroundColor Green
$bundlePaths = @(
  "target/release/bundle/msi/*.msi",
  "target/release/bundle/nsis/*.exe",
  "desktop/src-tauri/target/release/bundle/msi/*.msi",
  "desktop/src-tauri/target/release/bundle/nsis/*.exe"
)

$found = $false
foreach ($path in $bundlePaths) {
  Get-ChildItem $path -ErrorAction SilentlyContinue | ForEach-Object {
    $found = $true
    Write-Host $_.FullName
  }
}

if (-not $found) {
  Write-Host "No bundle files found. Check the build output above." -ForegroundColor Yellow
}
