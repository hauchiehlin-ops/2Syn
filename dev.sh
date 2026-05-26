#!/bin/bash

# 2syn 專案開發與測試一鍵啟動腳本

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # 無顏色

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}        2syn Remote Desktop PoC 啟動控制台        ${NC}"
echo -e "${BLUE}==================================================${NC}"

# 1. 檢查並安裝前端依賴項
echo -e "\n${YELLOW}[Step 1/4] 檢查前端 Node.js 環境與依賴項...${NC}"
if ! command -v npm &> /dev/null; then
    echo -e "${RED}錯誤: 本機未安裝 Node.js 與 npm，請先安裝以執行 Tauri 前端。${NC}"
    exit 1
fi

echo -e "${GREEN}Node.js 已偵測，正在安裝前端依賴套件...${NC}"
cd desktop
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}前端依賴安裝失敗。${NC}"
    exit 1
fi
echo -e "${GREEN}前端依賴安裝完成。${NC}"
cd ..

# 2. 檢查 Rust 環境
echo -e "\n${YELLOW}[Step 2/4] 檢查 Rust 編譯環境...${NC}"
if ! command -v cargo &> /dev/null; then
    echo -e "${YELLOW}提示: 未偵測到 cargo 命令。本系統核心使用 Rust 編寫。${NC}"
    echo -e "${YELLOW}若您要在本機編譯執行，請安裝 Rust 工具鏈：${NC}"
    echo -e "${BLUE}curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${NC}"
    echo -e "${YELLOW}並重啟終端機。${NC}"
    exit 1
fi
echo -e "${GREEN}Rust 環境已偵測: $(cargo --version)${NC}"

# 3. 啟動信令伺服器 (背景執行)
echo -e "\n${YELLOW}[Step 3/4] 正在背景啟動 WebSocket 信令搓合伺服器...${NC}"
cargo run --package syn-signaling &
SIGNALING_PID=$!

# 確保結束腳本時，信令伺服器也會被關閉
trap "kill $SIGNALING_PID; echo -e '\n${RED}已關閉信令伺服器。${NC}'; exit" INT TERM EXIT

LOCAL_IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo "127.0.0.1")
echo -e "${GREEN}信令伺服器已在背景啟動 (PID: $SIGNALING_PID)，接聽埠口: ws://0.0.0.0:8080/ws"
echo -e "👉 手機/其他區網設備請連線至: ws://${LOCAL_IP}:8080/ws${NC}"

# 4. 啟動 Tauri 應用程式 (開發模式)
echo -e "\n${YELLOW}[Step 4/4] 正在啟動 2syn Tauri 2.0 桌面應用程式...${NC}"
cd desktop
npm run tauri dev

# 如果 tauri dev 退出，會觸發 trap 關閉背景的信令伺服器
