param(
  [ValidateSet("Release", "Debug")]
  [string]$Configuration = "Release",
  [ValidateSet("x64")]
  [string]$Platform = "x64"
)

# 鎖定畫面用的 vhid 驅動為「選配」：
# - 建置或 staging 失敗（沒裝 WDK、沒有 .cat 等）只警告，照樣打包不含驅動的安裝檔，
#   hooks.nsh 會在編譯期偵測驅動檔是否存在而決定要不要打包。
# - 驅動未經 Microsoft 簽章時一般使用者本來就裝不起來，不應擋住整個安裝檔出版。
# - 設 SYN_REQUIRE_WINDOWS_DRIVER=1 可改回嚴格模式（驅動失敗即中止建置），供正式簽章版使用。

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$StageDir = Join-Path $RepoRoot "desktop\src-tauri\windows\driver"
$RequireDriver = $env:SYN_REQUIRE_WINDOWS_DRIVER -eq "1"

function Clear-StagedDriver {
  if (Test-Path $StageDir) {
    Get-ChildItem $StageDir -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne ".gitignore" } |
      Remove-Item -Force
  }
}

try {
  & (Join-Path $ScriptDir "build-windows-vhid.ps1") -Configuration $Configuration -Platform $Platform
  if ($LASTEXITCODE -ne 0) {
    throw "build-windows-vhid.ps1 failed with exit code $LASTEXITCODE"
  }

  & (Join-Path $ScriptDir "stage-windows-vhid-for-tauri.ps1") -Configuration $Configuration -Platform $Platform -RequireCatalog
  if ($LASTEXITCODE -ne 0) {
    throw "stage-windows-vhid-for-tauri.ps1 failed with exit code $LASTEXITCODE"
  }
} catch {
  if ($RequireDriver) {
    throw
  }
  # 清掉可能殘留的舊驅動檔，避免打包到過期或不完整的驅動
  Clear-StagedDriver
  Write-Warning "Windows lock-screen vhid driver was not built: $($_.Exception.Message)"
  Write-Warning "Continuing WITHOUT the driver. Lock-screen login will be unavailable in this installer."
  Write-Warning "Install the WDK and set SYN_REQUIRE_WINDOWS_DRIVER=1 to require it."
}

exit 0
