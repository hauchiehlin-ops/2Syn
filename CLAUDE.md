# 2syn Remote Desktop

跨平台遠端桌面軟體（類 Chrome Remote Desktop / RustDesk）。Rust + Tauri 2 + WebRTC 架構，
支援 macOS / Windows 作為被控端（host），macOS / Windows / iOS / Android 作為主控端（client）。

## 專案結構（Cargo workspace）

- `core/`（syn-core）— 核心函式庫：
  - `video.rs` / `codec.rs` / `mft_encoder.rs` — 螢幕擷取與 H.264 編碼（macOS 用 VideoToolbox + capscreen_macos，Windows 用 MFT）
  - `audio.rs` — 系統音訊擷取 → Opus（macOS：ScreenCaptureKit planar f32，**必須交錯後才能餵 Opus**；Windows：WASAPI loopback，含重取樣）
  - `input.rs` — 輸入事件協定（序列化/反序列化/`simulate()` 注入）；macOS 用 CGEvent、Windows 用 SendInput。macOS 雙擊靠 `MOUSE_EVENT_CLICK_STATE` 連擊追蹤（500ms/8px 內遞增）
  - `connection.rs` — WebRTC session、data channel 建立（host 端）、ABR 監控
  - `security.rs` / `file_transfer.rs` / `wol.rs` — 安全、檔案傳輸、網路喚醒
- `desktop/`（Tauri 2 app，host + client 雙角色同一套 UI）：
  - `src/main.ts` — **單一大檔（6000+ 行）**，包含全部 client UI 邏輯：WebRTC 信令、觸控手勢引擎、虛擬鍵盤、剪貼簿同步、懸浮選單、檔案傳輸 UI
  - `src-tauri/src/lib.rs` — Tauri 指令 + host 端 WebRTC（`answer_offer` 建立 pc、on_data_channel 處理 input/clipboard/file-transfer）
  - `src-tauri/gen/apple/` — iOS 專案（產品名 2syn_Client；macOS 為 2syn_Duel）
  - `tauri.conf.json`（host 版）/ `tauri.client.conf.json`（client 版）— 雙設定檔
- `signaling/` — WebSocket 信令伺服器（部署見 Dockerfile.signaling）
- `scripts/` — 版本 bump、iOS/Android 建置腳本

## 常用指令

```bash
./dev.sh                          # 一鍵啟動：清 port 8080 → 起 signaling → 起桌面 app
cargo check -p syn-core           # 核心編譯檢查
cd desktop && npx tsc --noEmit    # 前端型別檢查
cd desktop && npm run tauri:build:host           # macOS host 版
cd desktop && npm run tauri:build:ios:client     # iOS client 版
cd desktop && npm run bump:patch  # 版本號同步 bump（Cargo.toml + package.json + tauri conf）
```

## 架構要點（跨檔案協定，改一邊必須改另一邊）

- **輸入協定**：client（main.ts `buildInputPacket`）→ host（input.rs `deserialize`）。
  封包 = [seq:4B][timestamp:8B][eventType:1B][payload]。事件型別 0x01~0x09、0xFF 見 input.rs。
  MouseMove(0x01)/RelativeMove(0x07) 走 unreliable channel，其餘走 reliable；兩通道序號各自獨立遞增（重放防禦）。
- **Data channels**（client 建立）：`input-control`、`input-unreliable`、`system-control`、`clipboard`、`file-transfer`。
  host（connection.rs）另自建 `system-control` 通道，開啟時推送 `host_info`（含 OS），client 據此決定快捷鍵用 Cmd 或 Ctrl——**不要同時送兩組組合鍵**（會重複貼上/誤觸 SIGINT）。
- **鍵盤**：一般按鍵走 VK code（0x05/0x06，host 端 vk_to_mac_keycode 轉換）；IME 組字與虛擬鍵盤打字走 TextInput(0x08) Unicode 注入；host 忽略 modifiers byte，修飾鍵靠真實按住的鍵碼組合。
- **雙擊手勢**：client 第一次 tap 即送完整單擊，tap-tap 時 `sendDoubleClickSequence` 只補「第二擊」；macOS host 依連擊追蹤設 clickState=2。不要在 client 補送兩擊（會變三連擊）。
- **行動端鍵盤遮擋**：visualViewport 回調依 `kbFocusClientY`（未平移座標系）把 video 上移露出焦點；點擊時經 `getFocusClientY()` 記錄（軌跡板模式取合成游標位置，非手指位置）。

## 開發慣例

- 註解與 commit message 用繁體中文；commit 格式 `type(scope): 描述`（feat/fix/diag/docs/chore/revert）。
- iOS 特殊處理（autoplay 靜音啟動、focus 須在手勢同步鏈內、假 blur 延遲判定等）都有註解說明原因——改動前先讀註解。
- macOS 陷阱：xcap/NSScreen 不可在 WebRTC 背景執行緒呼叫（WindowServer 死鎖，見 connection.rs 註解）；CGEvent 合成事件需設 clickState。
- 每次完成有意義的變更後，在 `DEVLOG.md` 追加記錄（規則見該檔案開頭）。

## 相關文件

- `DEVLOG.md` — 開發歷程記錄
- `docs/` — 多語系使用手冊、隱私政策、App Store 送審資料
- `docs/ios27-debugging-journey.md` — iOS 27 相容性除錯全記錄
