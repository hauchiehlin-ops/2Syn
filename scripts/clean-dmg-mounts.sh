#!/usr/bin/env bash
# =============================================================================
# clean-dmg-mounts.sh
#
# 在打包 macOS DMG 前先做清理，避免常見的打包失敗：
#   殘留已掛載的 2syn 卷宗 → 打包暫存卷宗名稱衝突（被改掛成 "2syn_Duel 1"）
#   → create-dmg 的 AppleScript `tell disk "2syn_Duel"` 找不到碟 (-1728)
#   → 打包中止並把暫存 DMG 留在掛載狀態 → 下次更糟（連鎖）。
#
# 由 npm script（tauri:build:host）於 `tauri build` 前呼叫。永遠以 0 結束，
# 確保純清理不會中斷後續建置。
# =============================================================================
set -u

# 1) 卸載任何已掛載、會與打包卷宗名衝突的 2syn 卷宗（含 "... 1"/"... 2" 編號變體）
for vol in /Volumes/2syn_Duel* /Volumes/2syn_Client*; do
  [ -e "$vol" ] || continue
  if diskutil eject "$vol" >/dev/null 2>&1; then
    echo "[clean-dmg] ejected $vol"
  else
    echo "[clean-dmg] WARN: 無法卸載 $vol（可能正被使用），請手動退出後再 build" >&2
  fi
done

# 2) 清除上次失敗殘留的暫存可寫 DMG（rw.*.dmg）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for d in \
  "$SCRIPT_DIR/../target/release/bundle/macos" \
  "$SCRIPT_DIR/../target/aarch64-apple-darwin/release/bundle/macos" \
  "$SCRIPT_DIR/../target/x86_64-apple-darwin/release/bundle/macos"; do
  if compgen -G "$d/rw.*.dmg" >/dev/null 2>&1; then
    rm -f "$d"/rw.*.dmg && echo "[clean-dmg] removed stale rw.*.dmg in $d"
  fi
done

exit 0
