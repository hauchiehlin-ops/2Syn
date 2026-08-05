#!/usr/bin/env bash
# =============================================================================
# share-file.sh
#
# 透過 cloudflared 臨時 tunnel 把安裝檔對外公開，讓對方用瀏覽器直接下載，
# 無需安裝 VPN 或任何額外 App。
#
# 用法：
#   ./scripts/share-file.sh <檔案路徑或目錄路徑>
#
# 範例：
#   # 分享單一 exe
#   ./scripts/share-file.sh desktop/src-tauri/target/release/bundle/nsis/2syn_Duel_6.5.0_x64-setup.exe
#
#   # 分享整個 bundle 目錄（讓對方可以自選 .exe 或 .msi）
#   ./scripts/share-file.sh desktop/src-tauri/target/release/bundle/nsis
#
#   # 分享 Android APK
#   ./scripts/share-file.sh desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release
#
# 停止方式：按 Ctrl+C，tunnel 隨即關閉，連結立即失效。
# =============================================================================

set -euo pipefail

# ── 顏色輸出 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[share]${NC} $*"; }
success() { echo -e "${GREEN}[share]${NC} $*"; }
warn()    { echo -e "${YELLOW}[share]${NC} $*"; }
error()   { echo -e "${RED}[share]${NC} $*" >&2; }

# ── 依賴檢查 ──────────────────────────────────────────────────────────────────
check_dep() {
    local cmd=$1 install_hint=$2
    if ! command -v "$cmd" &>/dev/null; then
        error "找不到指令: $cmd"
        echo "  安裝方式: $install_hint"
        exit 1
    fi
}

check_dep python3  "brew install python3  /  winget install Python.Python.3"
check_dep cloudflared \
    "Mac: brew install cloudflared  |  Windows: winget install Cloudflare.cloudflared"

# ── 參數解析 ──────────────────────────────────────────────────────────────────
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
    error "請指定要分享的檔案或目錄"
    echo "  用法: $0 <檔案路徑 | 目錄路徑>"
    exit 1
fi
if [[ ! -e "$TARGET" ]]; then
    error "路徑不存在: $TARGET"
    exit 1
fi

# ── 決定 serve root 與提示路徑 ────────────────────────────────────────────────
if [[ -d "$TARGET" ]]; then
    SERVE_DIR="$(cd "$TARGET" && pwd)"
    HINT_PATH=""
else
    SERVE_DIR="$(cd "$(dirname "$TARGET")" && pwd)"
    FILENAME="$(basename "$TARGET")"
    HINT_PATH="/$FILENAME"
fi

# ── 選一個空閒 port ───────────────────────────────────────────────────────────
PORT=0
for candidate in 8787 8788 8789 8790; do
    if ! lsof -i ":$candidate" &>/dev/null 2>&1; then
        PORT=$candidate; break
    fi
done
if [[ $PORT -eq 0 ]]; then
    error "找不到空閒 port（試過 8787-8790），請手動關閉佔用程序"
    exit 1
fi

# ── 清理 handler ──────────────────────────────────────────────────────────────
HTTP_PID=""
TUNNEL_PID=""
cleanup() {
    echo ""
    info "正在關閉 tunnel 與檔案伺服器..."
    [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
    [[ -n "$HTTP_PID"   ]] && kill "$HTTP_PID"   2>/dev/null || true
    success "連結已失效，對方無法再下載。"
}
trap cleanup EXIT INT TERM

# ── 啟動 HTTP server ──────────────────────────────────────────────────────────
info "啟動本機 HTTP server（port $PORT，目錄: $SERVE_DIR）..."
python3 -m http.server "$PORT" --directory "$SERVE_DIR" \
    >/tmp/2syn-httpserver.log 2>&1 &
HTTP_PID=$!
sleep 1
if ! kill -0 "$HTTP_PID" 2>/dev/null; then
    error "HTTP server 啟動失敗，請查看 /tmp/2syn-httpserver.log"
    exit 1
fi

# ── 啟動 cloudflared tunnel ───────────────────────────────────────────────────
info "建立 cloudflared tunnel，取得公開 HTTPS 網址..."
TUNNEL_LOG="$(mktemp /tmp/2syn-tunnel-XXXX.log)"
cloudflared tunnel --url "http://localhost:$PORT" \
    --no-autoupdate \
    >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# 等待連結出現（最多 20 秒）
PUBLIC_URL=""
for i in $(seq 1 40); do
    PUBLIC_URL=$(grep -oE 'https://[a-z0-9\-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
    [[ -n "$PUBLIC_URL" ]] && break
    sleep 0.5
done

if [[ -z "$PUBLIC_URL" ]]; then
    error "cloudflared 無法建立 tunnel，請確認網路連線"
    echo "  詳細 log: $TUNNEL_LOG"
    exit 1
fi

# ── 印出分享資訊 ──────────────────────────────────────────────────────────────
echo ""
success "═══════════════════════════════════════════════════════"
success "  Tunnel 已建立！把以下連結傳給對方："
echo ""
if [[ -n "$HINT_PATH" ]]; then
    echo -e "  ${GREEN}直接下載連結：${NC} ${PUBLIC_URL}${HINT_PATH}"
    echo ""
    echo -e "  ${CYAN}目錄瀏覽連結：${NC} ${PUBLIC_URL}/"
else
    echo -e "  ${GREEN}目錄瀏覽連結：${NC} ${PUBLIC_URL}/"
fi
echo ""
warn "  注意："
warn "  ‧ Windows 安裝時 SmartScreen 可能出現「無法識別的應用程式」警告"
warn "    → 請對方點「更多資訊」→「仍要執行」"
warn "  ‧ Android 安裝時 Play Protect 可能出現警告"
warn "    → 請對方點「仍要安裝」"
warn "  ‧ 按 Ctrl+C 可立即關閉 tunnel，連結隨即失效"
success "═══════════════════════════════════════════════════════"
echo ""
info "等待傳輸中（按 Ctrl+C 結束）..."

# ── 保持前景等待 ──────────────────────────────────────────────────────────────
wait "$TUNNEL_PID"
