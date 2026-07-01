# 2syn 開發歷程（DEVLOG）

## 記錄規則

1. **何時記**：每完成一項有使用者可感知的變更（修 bug、新功能、重要重構、除錯結論），追加一節。
2. **怎麼記**：新記錄加在「歷程」最上方（新→舊）。格式：

   ```markdown
   ## YYYY-MM-DD — 標題

   - **問題/目標**：一句話說明
   - **根因/做法**：技術上的關鍵點（含檔案:行數）
   - **教訓**（可選）：下次可以少走的彎路
   ```

3. **記什麼**：根因與「為什麼這樣修」比「改了哪些行」重要；git diff 能看的不用抄。
4. **除錯未果也記**：排除掉的假設是有價值的（參考 docs/ios27-debugging-journey.md 的寫法）。

---

# 歷程

## 2026-07-02 — 四項體驗 bug 修復（音訊失真/貼上重複/雙擊失效/鍵盤遮擋）

- **問題 1：遠端音訊到 client 完全失真**
  - 根因：macOS ScreenCaptureKit 音訊為 **planar（每聲道一個 buffer）f32**，`core/src/audio.rs` 舊碼把兩個聲道 buffer 直接串接當 interleaved 立體聲餵 Opus → 波形完全錯亂。
  - 做法：≥2 buffers 時手動交錯 L/R；單 buffer 依 `number_channels` 區分 mono（複製成雙聲道）/interleaved。Windows WASAPI 端補上聲道正規化與 48kHz 線性內插重取樣（44.1kHz 裝置直接餵 Opus 會失真）。
- **問題 2：remote 複製後貼上輸入欄位，文字重複**
  - 根因：懸浮選單「貼上/複製/全選」為了雙系統相容**同時送 Cmd+V 與 Ctrl+V 兩組組合鍵**（main.ts 懸浮選單 action handler），部分環境兩組都觸發（Windows 的 Win+V 還會打開剪貼簿歷史）。
  - 做法：host（connection.rs `setup_system_control_channel` on_open）推送 `host_info`（OS 資訊），client 據此只送單一正確組合鍵；未知時預設 macOS。main.ts 主要 pc.ondatachannel 補綁 host 自建的 `system-control` 通道。
- **問題 3：單指雙擊無法開啟資料夾（檔案管理）**
  - 根因（雙重）：macOS `CGEvent` 合成點擊的 `MOUSE_EVENT_CLICK_STATE` 恆為 1（macOS 雙擊判定要求第二擊帶 clickState=2，不像 Windows 由系統計時判定）；且 client 端 tap-tap 手勢在第一次 tap 已送單擊後，`sendDoubleClickSequence` 又補送兩擊 → 累積成三連擊。
  - 做法：input.rs macOS 端加入連擊追蹤（左鍵 500ms 內、位移 ≤8px → clickState 遞增 1→2→3，MouseUp 沿用同值）；client `sendDoubleClickSequence` 改為只補「第二擊」。另修正 touchend 尾端無條件覆寫 `lastTapTime` 導致「雙擊後重設為 0 防三連」失效的問題。
- **問題 4：虛擬鍵盤彈出時遮住輸入欄位**
  - 根因：visualViewport 上移邏輯依賴 `kbFocusClientY`，但全檔**只有重設為 -1、從未賦過實際值** → 上移量恆為 0。
  - 做法：新增 `getFocusClientY()`（Direct Touch＝手指位置；Trackpad＝合成游標的螢幕位置；統一換算回未平移座標系，扣除 `keyboardOffsetUpdateY`），在開鍵盤與「鍵盤開著時點新焦點」兩個時機賦值並立即重算平移。
- **教訓**：
  - CoreAudio/SCK 的 AudioBufferList「一個 buffer 一個聲道」是預設，拿到音訊先確認 planar vs interleaved。
  - 「同時送兩套快捷鍵求相容」這種 shotgun 做法必然在某些 app 雙觸發，正解是讓 host 回報自身 OS。
  - macOS 合成事件的雙擊/三擊是「事件自帶 clickState」，不是系統幫你算。

## 2026-07-02 之前

早期歷程未逐項回填，重點里程碑可查 `git log`：
- 觸控筆壓力感應（PenMove 0x09，CGEvent tablet subtype）、隱私模式 QR code
- iOS client：autoplay 靜音啟動、隱形 input 觸發鍵盤、游標顯示修正
- macOS host 12fps 瓶頸排查（空樣本 sleep 問題）→ 修復，過程見 `diag(video)` 系列 commits
- iOS 27 相容性長篇除錯：見 `docs/ios27-debugging-journey.md`
