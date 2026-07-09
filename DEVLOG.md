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

## 2026-07-09 — 剪貼簿同步優化：解決本地複製文字無法在遠端貼上之問題

- **問題/目標**：解決主控端複製文字後，無法在被控端貼上的問題。
- **根因/做法**：
  1. 網頁版主控端因為瀏覽器安全性限制，沒有背景輪詢本機剪貼簿的功能，而原有 `copy` 事件監聽僅限於網頁 DOM 內觸發的複製，外部複製無從得知。
  2. 桌面端（Tauri）雖有 1.5 秒輪詢，但若在外部複製後立即按下貼上，會遇到輪詢尚未觸發的時間差（Lag）。
  3. 懸浮選單與快速鍵貼上時，並未在送出 Ctrl+V/Cmd+V 前強制讀取並推播最新剪貼簿。
  4. 主控端收到被控端推播剪貼簿時未更新 `_lastRemoteClipboard`，導致後續輪詢時引發不必要的二次回傳環路。
  - **做法**：
    - 於 `desktop/src/main.ts` 新增 `readLocalClipboard` 與 `pushClipboardToHost` 輔助函式，支援自動在 Tauri `read_clipboard` 與瀏覽器 `navigator.clipboard.readText()` 之間降級。
    - 攔截 `keydown` 監聽中的 `Ctrl+V` 與 `Cmd+V` 快速鍵，以及懸浮選單的「貼上」按鈕，執行 `pushClipboardToHost().finally(...)`，確保在模擬快速鍵送給被控端之前，先將本機最新剪貼簿內容完成推播同步。

## 2026-07-07 — 語系切換「當下有效、重開程式後失效」：dist 建置產物過舊（非邏輯 bug）

- **問題/目標**：上一筆語系持久化修正上線後，使用者回報「切換語系當下沒問題，但退出程式重開後又回到修改前的語系，沒有記住上次選擇」。
- **根因/做法**：先用 preview 工具在瀏覽器內對新程式碼實測（設定語系 → `localStorage` → `location.reload()`），確認邏輯本身完全正常、能正確沿用。真正問題是 `desktop/src-tauri/tauri.conf.json` **沒有設定 `devUrl`**——Tauri 視窗因此無論 `tauri dev` 或正式建置，一律直接讀取 `desktop/dist/` 這份**靜態建置檔**，不會走 vite dev server 的即時熱重載。而 `dist/assets/*.js` 是修正前（7/6 18:41）的舊建置，反組譯確認裡面仍是舊版 `navigator.language` 系統語系偵測、完全沒有本次新增的 `2syn_lang` 持久化邏輯——使用者測到的其實是**舊版程式碼**的行為（切換當下靠舊版 `loadLanguage()` 即時生效，重開後舊版邏輯重新偵測系統語系，從未寫入任何持久化紀錄）。
- **修法**：執行 `npm run build` 重新產生 `dist/`，並反組譯新產物確認含有 `2syn_lang`、不再含 `navigator.language`。
- **教訓**：這個專案的 `tauri.conf.json` 缺少 `devUrl`，代表**改 `desktop/src/main.ts` 後必須手動 `npm run build`** 才會反映到實際執行的 app（`./dev.sh`／`tauri dev`／已安裝的正式版皆同），單純改原始碼、重開程式測試是不夠的。日後遇到「程式碼看起來對、但實際行為像舊版」的落差，先比對 `dist/assets/*.js` 的建置時間戳與原始碼修改時間。

## 2026-07-07 — UI 預設語系改為英文（並記住使用者選擇）

- **問題/目標**：應用程式 UI 介面語系預設改為英文。
- **根因/做法**：`initI18n()`（[main.ts:874](desktop/src/main.ts:874)）原本依 `navigator.language` 偵測系統語系、fallback 繁體中文。改為一律預設 `en`，並把語系下拉選單的變更寫入 `localStorage`（key：`2syn_lang`，載入時驗證仍是有效選項），使用者手動切換過的語系重啟後沿用。`fallbackTranslations` 與 `index.html` 靜態文字本就是英文，無需改動。

## 2026-07-07 — 修正 client 打字傳到 host 時快時慢（Android 鍵盤組字緩衝）

- **問題/目標**：client 鍵盤輸入文字傳到 host 有時候非常慢（非網路問題）。
- **根因/做法**：
  1. **主因**：Android 的 Gboard/三星鍵盤即使 `autocorrect="off"` 也把一般英文打字放在 IME 組字（composing span）狀態，要按到空白鍵/標點才 commit。而 `main.ts` 行動端鍵盤的 input handler 遇到 `isComposing` 一律 `return` 等 `compositionend`——結果整個單字期間 host 完全收不到字，按空白後才一次爆出來，體感「打字很慢」。iOS 英文輸入不走組字所以正常——這就是「有時候慢」的原因（平台/鍵盤模式相依，與網路無關）。
  2. **修法**（[main.ts:5382](desktop/src/main.ts:5382)）：拉丁字母組字改為「邊打邊串流」——每次組字內容變化即送出與已串流內容的差異（`reconcileStreamed`：保留共同前綴、其餘退格重送），`compositionend` 時再對最終字串補一次差異，天然涵蓋自動修正（teh→the）與拼音字母→漢字 commit 的替換。CJK 組字（注音符號等非拉丁內容）維持等 `compositionend` 才送，避免把組字中間狀態打到遠端。
  3. **順手修**：`sendInputPacket`（[main.ts:3513](desktop/src/main.ts:3513)）在 unreliable 通道未開時會把 MouseMove fallback 到 reliable 通道，但封包帶的是 unreliable 序號計數器——會污染 host 端 `input-control` 的 `last_seq`，讓後續鍵盤/點擊封包在序號差 ≤256 時被重放防禦（`SecureInputPacket::verify` 的 `SEQ_RESET_THRESHOLD`）誤判丟棄。改為 fallback 時重寫序號為 reliable 計數器。
- **教訓**：行動端 WebView 的「一般打字」不保證走 `insertText`——Android 主流鍵盤在預測模式下全部走組字事件流。凡是「組字中不送、等 commit」的設計，都要區分「真 IME 組字（CJK）」與「自動修正緩衝（拉丁）」兩種情境，後者必須即時串流否則體感延遲以「單字」為單位。

## 2026-07-06 — 修正 MacBook Air 游標偏移真正根因（SCK 擷取黑邊，非競態）

- **問題/目標**：前一筆「跨 channel 競態」修正上線後，MacBook Air host 的游標偏移**沒有改善**——固定約 1 公分、穩定重現，代表是系統性映射錯誤，不是時序競態。
- **根因/做法**：
  1. `core/src/video.rs` 建立 SCK stream 時**從未設定輸出寬高**，`SCStreamConfiguration` 使用 Apple 預設 1920×1080（16:9）。MacBook 內建螢幕是 ~1.54:1（Air 13 吋 2560×1664），ScreenCaptureKit 會把畫面等比縮放後置中、**左右補黑邊烘進影格**。client 把整張 16:9 影格當成螢幕做比例映射，於是產生水平方向的系統性偏移：螢幕中央為 0、越靠左右邊緣越大（理論最大 ~6.7% 寬 ≈ 2cm）。Mac mini 接 16:9 外接螢幕時長寬比剛好一致、無黑邊，所以完全準確——這就是「一台準一台不準」的真正原因。
  2. **修法**（`core/src/video.rs`）：新增 `fit_to_aspect()`，把 ABR 的 16:9 目標解析度當「像素預算」，實際輸出尺寸依 `display.frame()` 的長寬比修正（偶數對齊）；SCK config 明確 `with_width/with_height`（加 `scales_to_fit(true)` 保險）；編碼器 session 同步 reconfigure 成相同尺寸避免 VT 二次縮放；ABR 解析度變更時強制重建 SCK stream 保持兩者一致。
- **教訓**：「固定、可穩定重現」的偏移是映射鏈某一段的長寬比/座標系不一致，「時好時壞」才可能是競態。下次先量化偏移的空間分佈（中央 vs 邊緣、水平 vs 垂直）再下診斷——本例「中央準、越往兩側越偏」一測就能直指黑邊。前一筆點擊帶座標的協定修正仍保留（它修掉的是真實存在的另一個潛在競態）。

## 2026-07-06 — 修正滑鼠點擊位置偏移（MouseDown/Up 跨 channel 座標競態）

- **問題/目標**：遠端連線到 Mac mini 時滑鼠定位準確，但連線到 MacBook Air 時點擊位置與實際指向點相差約 1 公分。
- **根因/做法**：
  1. 先排除了 Retina/DPI 縮放假設——`core/src/input.rs` 的座標換算本就是用 points（`CGDisplay`/`SCDisplay.frame()`）而非 pixel，且 client 端是比例對比例映射，理論上與 scale factor 無關；也排除了多螢幕假設（MacBook Air 並未外接螢幕）。
  2. 真正根因：`MouseDown`/`MouseUp` 封包本身不帶座標，host 端點擊時讀取的是另外追蹤的「上一筆 `MouseMove` 座標」（`get_global_cursor()`）。但 `MouseMove` 走 `input-unreliable` data channel，`MouseDown`/`MouseUp` 走 `input-control`（reliable）——WebRTC 的兩個 data channel 之間**沒有到達順序保證**。若 `MouseDown` 比最後一筆 `MouseMove`更早送達 host，點擊就會用到舊座標，偏移量恰好等於「這段時間游標移動的距離」。兩台 host 因為網路/編碼負載造成的相對抖動不同，競態觸發機率也不同，導致只有一台觀察到偏移。
  3. **修法**：讓 `MouseDown`/`MouseUp` 封包自帶座標（`core/src/input.rs`：payload 由 1 byte 的 button 擴充為 `button + x(4B) + y(4B)`；macOS 端 `simulate()` 直接用封包座標建 `CGPoint`，不再呼叫 `get_global_cursor()`；Windows 端同步补上 `MOUSEEVENTF_ABSOLUTE` 絕對定位，之前完全沒有設定位置）。Client 端（`desktop/src/main.ts`）新增 `buildMouseButtonPayload()`，所有 ~20 處觸發點擊/放開的呼叫點都改用手勢當下已知的正規化座標（`currentCursorPercentX/Y`、`trackpadCursorX/Y`，或該手勢分支剛算出的 `x,y`）打包送出，不再依賴跨 channel 的共享狀態。
- **教訓**：任何「按鈕事件依賴另一個獨立訊息流之前已同步的狀態」的設計，只要那個獨立訊息流走的是不同 channel/不保證順序的傳輸，就有競態風險；出現「時好時壞、隨網路環境變化」的小幅度定位誤差時，比起怀疑座標換算公式，更該先怀疑「跨 channel/跨事件的隱含時序假設」。

## 2026-07-05 — 修正 Android 端連線逾時相容性問題 (WebRTC connectionState)

- **問題/目標**：解決 Android Client 成功連線後瞬間斷開（約 0.24 秒）的問題，確保 Android WebView 環境下連線穩定性。
- **根因/做法**：
  1. **API 不支援**：部分 Android System WebView 版本不支援 `RTCPeerConnection.connectionState` 屬性，回傳 `undefined`。這使得我們新增的 15 秒連線逾時計時器在檢查 `peerConnection.connectionState !== "connected"` 時恆為 `true`，從而在時間截止時（正好是 Client 點擊連線後的第 15 秒，此時 Host 通常才連上 0.2 秒）誤判並主動斷開連線。
  2. **相容性修復**：修改 [main.ts](file:///Users/barretlin/GitProjects/2syn/desktop/src/main.ts) 的 `connectionTimeoutTimer` 邏輯，將檢查條件擴展至相容性更佳的 `iceConnectionState`，同時檢查兩個狀態：`cState !== "connected" && iceState !== "connected" && iceState !== "completed"`。
  3. **雙狀態主動清除**：在 `oniceconnectionstatechange` 與 `onconnectionstatechange` 的成功或終態事件中，均加上對 `connectionTimeoutTimer` 的清除邏輯，確保定時器能在連線成功時即時被註銷。
- **教訓**：
  - 各平台 WebView 容器對 WebRTC 新 API（如 `connectionState`）的支援度存在差異。對於涉及連線斷開的關鍵判定，應優先使用相容性更好、歷史更久的 `iceConnectionState` 作為後備。

## 2026-07-05 — 重新設計並替換為 3D 應用程式圖示

- **問題/目標**：原本的黃色鎖頭圖示過於單調，需要重新設計為具有 3D 質感、能傳達遠端連線同步概念的應用程式圖示。
- **根因/做法**：
  1. 使用 Image Generator 工具生成了三款 3D 風格的圖示提案，使用者選定了「提案三：雙端串流投影」（由 3D 顯示器與智慧型手機組成，中間連接著霓虹數據串流）。
  2. 使用 macOS 的 `sips` 工具將所選 JPG 圖片格式轉換為 PNG（`icon_option_3.png`）。
  3. 透過 Tauri CLI `tauri icon` 命令，重新生成適用於 Host 與 Client 等所有主要平台（macOS、Windows、iOS、Android）之 50+ 個縮放尺寸的圖示，分別輸出至 `desktop/src-tauri/icons/` 與 `desktop/src-tauri/icons-client/` 目錄中。

## 2026-07-05 — 移除黑屏錯誤覆蓋層、新增 15 秒連線逾時機制與全面支援多國語系

- **問題/目標**：
  1. 連線中/黑屏時顯示的「強制播放、播放主機日誌、關閉」覆蓋層被證明在 ICE 協商期間太早觸發（第 4 秒），干擾且誤導使用者。
  2. 需要在連線無法建立時設定自動逾時，防止介面無限期停留在 `Connecting`。
  3. 部分動態產生的 UI 按鈕與對話框提示詞（如檔案傳輸、登出按鈕等）未套用多國語系。
- **根因/做法**：
  1. **移除黑屏覆蓋層**：刪除了 `index.html` 中的 `video-error-overlay` DOM 結構，並清除了 `main.ts` 內 `ontrack` 的 4 秒黑屏檢測與按鈕監聽器。
  2. **15 秒連線逾時**：在 `startCall` 發起連線時加上 15 秒的 `setTimeout`，逾時若未進入 `connected`，則主動轉化連線狀態為 `failed` 並 Alert 提示；同時在連線成功與 `resetConnectionUI` 時確實清除定時器。
  3. **語系全面化**：實作了 `syncStatefulLabels` 動態語意更新函式，確保直控/軌跡板、鍵盤、靜音、登出等按鈕隨語言及狀態即時更新；同時將寫死的 `alert` 與 `showToast` 全面改為 `t(...)` 取值，並將新增的 14 個翻譯鍵追加至所有 11 國語系檔（`desktop/public/locales/*.json`）與 `fallbackTranslations` 中。
- **教訓**：
  - WebRTC 連線可能受到打洞速度影響，過於武斷的黑屏計時器（例如 4 秒）容易在 ICE 正常協商完成前就誤報錯誤。應使用總體連線逾時機制（例如 15 秒）來代替提前黑屏判斷。
  - 對於帶有狀態的 UI 標籤，需要一個統一的狀態更新函式，以確保當語系或元件狀態變更時，顯示文字能始終保持一致且即時翻譯。

## 2026-07-05 — 行動端/窄螢幕下快顯功能選單無法關閉且部分選項裁切

- **問題/目標**：行動裝置上使用觸控時，快顯功能選單點擊外部無法關閉，且在窄螢幕或偏邊緣點擊時，選單超出螢幕邊界被裁切（導致取消 `✕` 等按鈕無法點擊）。
- **根因/做法**：
  1. **無法關閉**：`videoEl` 在觸控事件（`touchstart` / `touchend`）中呼叫了 `e.preventDefault()` 阻止了滑鼠事件模擬，導致全域僅監聽 `click` 事件來關閉選單失效。在 `document` 上同步註冊 `touchstart` 監聽器（並將 dismiss 邏輯統整為 `dismissFloatingMenu`）解決此問題（[main.ts:5622](desktop/src/main.ts#L5622)）。
  2. **選單裁切**：選單固定使用 `fixed` 且橫向置中於點擊處。在 `showFloatingMenu` 建立選單並 `appendChild` 後，即時以 `getBoundingClientRect()` 取得其實際寬高，進行左右與上下邊界安全檢測（限制邊距 `12px`），超出時自動偏移（[main.ts:5604](desktop/src/main.ts#L5604)）。
- **教訓**：
  - 行動端的 `touchstart` / `touchend` 攔截 `preventDefault()` 會直接阻斷瀏覽器模擬的 `click` 事件向上氣泡傳播，因此全域 dismiss 類型的偵聽器必須同時涵蓋 `touchstart` 與 `click`。
  - 對於浮動定位的選單，特別是在窄螢幕或行動端環境下，必須在 DOM 渲染後立即測量尺寸並進行 Viewport 安全邊界校正，以免 UI 溢出造成無法還原的死局。

## 2026-07-03 — 連線循環數次後被控端掉線「Target offline」（session 擷取任務洩漏）

- **問題**：連線登入/登出數次後，最終無法登入，client 顯示類似「HOST 不在線上（Target offline）」。
- **根因**：`handle_remote_offer_as_host`（lib.rs）每次 Offer 都建立新 session，spawn **video 擷取迴圈（`spawn_blocking`）＋ audio 擷取迴圈 ＋ ABR 監控**。但 video/audio 迴圈只依全域 `has_active_webrtc` 決定「暫停」，**從不 EXIT**——非活躍時只是 `sleep` 後繼續 loop。每次連線/斷線循環就洩漏一組永不結束的擷取任務。累積後耗盡 tokio blocking 執行緒池（預設上限）與 CPU（多條 SCStream 每 100ms 醒來），拖垮同進程的信令心跳（10s ping / 35s watchdog）→ 被控端從信令伺服器掉線 → client 送 Offer 得到「Target offline」。
- **做法（每 session 存活旗標 + 終態回收）**：
  1. 每個 session 建立 `session_alive: Arc<AtomicBool>`，clone 傳入 video（[video.rs:152](core/src/video.rs:152)）與 audio（[audio.rs:31](core/src/audio.rs:31)）擷取迴圈；迴圈頂端檢查，false 時停掉 SCStream 並 `break` 徹底結束執行緒。
  2. `on_peer_connection_state_change` 於 `Failed`/`Closed` 時把 `session_alive` 歸零；且 `Failed` 時主動 `pc.close()` → 轉 `Closed` → ABR 監控任務（[connection.rs:170](core/src/connection.rs:170) 本就 break on Closed）跳出、data channel 關閉、pc Arc 釋放。
  3. 搭配前述「新 Offer 前 close 舊 pc」：重連立即回收舊 session；純登出則於 ICE 逾時轉 Failed 後回收。
- **教訓**：長生命週期的擷取迴圈只有「暫停」沒有「結束」條件，在重複連線場景等同資源洩漏；每個綁定於單一 session 的 spawn 任務都必須有明確的 per-session 終止信號。被控端的**信令連線與 WebRTC 擷取共用同一進程**，擷取端資源洩漏會反噬信令存活 → 表象是「連不上」，實因是「被控端過載掉線」。

## 2026-07-03 — 「遠端主機診斷日誌」永遠停在載入中（無逾時）

- **問題**：連不上遠端時開啟「遠端主機診斷日誌」，畫面永遠停在「載入遠端日誌中...」無反應。
- **根因（設計邏輯缺陷）**：此功能透過信令送 `custom_request_logs` 給被控端、**等被控端回 `custom_response_logs`**（main.ts `initRemoteLogsDiagnostics`）。但它常在「連不上遠端」時使用——而連不上的主因往往正是被控端離線，請求送不到、也永遠等不到回覆。程式碼無逾時、無失敗分支，故永久停在載入中。
- **做法**：送出前先檢查信令通道與 `currentRemoteId`，缺任一即 toast 提示不開 modal；送出後啟動 8 秒逾時計時器（`remoteLogsTimeout`），逾時顯示明確失敗說明（被控端未執行/離線/網路不通）；收到回覆或關閉 modal 時清除計時器。新增 3 組 i18n key（`remote_logs_no_signaling`/`no_target`/`timeout`，fallbackTranslations 英文 + zh-TW.json 繁中）。
- **教訓**：任何「送請求→等對方回覆」的 UI 都必須有逾時與失敗態；尤其是「診斷連線問題」的工具，本身絕不能假設連線正常，否則在最需要它的情境（對方離線）反而失效。

## 2026-07-03 — 畫面凍結 fps 0.0 永不恢復（has_active_webrtc 被舊 session 打成 false）

- **問題**：iOS 登入一段時間後畫面凍結、重登也無法解開，但輸入其實正常（診斷日誌顯示 `[Input] 已送出點擊事件` 持續、RTT 5~11ms 正常，但 `[Stats] fps 0.0`、freeze watchdog 每 2 秒觸發卻救不回）。
- **根因**：`has_active_webrtc` 是**全域共享 AtomicBool**，被**每一條** session 的 `on_peer_connection_state_change` 寫入（[lib.rs:447](desktop/src-tauri/src/lib.rs:447)）。時序：新 session 連上設 true → 影像流動；之後**洩漏的舊 session 逾時**或 iOS ICE 短暫抖動觸發 `Disconnected` → 把共享旗標打成 **false** → host video 擷取迴圈（[video.rs:288](core/src/video.rs:288)）判定非活躍而停掉 SCStream、macos_stream=None → **fps 0.0 凍結**；當前 session 已是 Connected 不會再觸發 → **永不恢復**。輸入不受影響因 `simulate()` 不看此旗標。
- **做法**：state change handler 捕捉本 session 的 `pc` identity；`Connected` 一律設 true（安全方向），但**設 false 僅限本 pc 仍是當前 `active_pc`**（`Arc::ptr_eq`）時才生效，忽略舊/非當前 session 的遲來斷線事件（[lib.rs:447](desktop/src-tauri/src/lib.rs:447)）。擷取迴圈本就會在 `macos_stream.is_none()` 時重建 SCStream（[video.rs:358](core/src/video.rs:358)），故旗標一旦保持正確即自動恢復。
- **教訓**：跨多條 session 共享的可變旗標，任何一條 session 的 callback 都能污染它；生命週期綁定於「單一連線」的狀態，寫入前必須先確認事件來自當前 active 連線（pointer identity 比對），否則舊 session 的遲來事件會反噬新連線。這與前述 session 洩漏、序號殘留是同一類「舊 session 未隔離」根因家族。

## 2026-07-03 — iOS 重連後點擊失效（追加）：host 舊 session 未關閉而洩漏

- **問題**：承下節，序號容錯修正後 iOS 重連點擊失效仍可能復現。
- **根因（更底層）**：`handle_remote_offer_as_host`（lib.rs）每次新連線建立新 `WebRtcSession`，並在 [lib.rs:604](desktop/src-tauri/src/lib.rs:604) 把 `active_pc` **直接覆寫成新 pc、但從未 close 舊 pc**。舊 pc 靠自身 callback 與 spawn 的 video/audio/status 任務持有 Arc 而存活 → **session 洩漏**。iOS WKWebView 斷線常不乾淨關閉 SCTP/data channel，舊 session 的 input-control on_message、擷取迴圈、全域輸入狀態全部還活著，與新 session 爭用 → 半失效（點擊失效、移動正常）。Android 斷線清理乾淨故不洩漏、不觸發。
- **做法**：換上新 pc 前，先 `replace` 取出舊 pc 並 `old.close().await`（背景 spawn），確保任一時刻只有單一 active session（[lib.rs:604](desktop/src-tauri/src/lib.rs:604)）。
- **教訓**：WebRTC pc 會被自身 callback／spawn task 的 Arc 撐住，函式結尾 drop 區域變數**不等於**關閉連線；必須顯式 `close()`。「換新前先關舊」應是所有 host 重連路徑的預設動作。

## 2026-07-03 — iOS 重連後點擊完全失效（序號重放防禦誤擋）

- **問題**：iOS client 連 macOS host，初次操作正常；**斷線一次後重新連線，滑鼠點擊突然完全失效**（移動仍正常）。Android client 同流程正常。
- **根因**：輸入封包的重放防禦 `SecureInputPacket::verify` 規則為「序號必須嚴格遞增（`seq > last_seq`）」。client 端 `controlSeqNumber` 是**全域單調遞增、重連不歸零**的計數器；host 端每條 `input-control` 通道各有獨立 `last_seq`。iOS WKWebView 斷線時常無法乾淨關閉 data channel，舊 host session 洩漏、殘留高 `last_seq`；重連後新連線的封包序號一旦低於殘留值即被判定為重放而**靜默全丟**。點擊/鍵盤走 reliable 通道故失效；移動走 unreliable 通道、序號體系獨立，故不受影響。Android WebRTC 斷線清理較乾淨，未觸發。
- **做法（雙管齊下，[input.rs:853](core/src/input.rs:853)、[main.ts:1931 附近](desktop/src/main.ts:1931)）**：
  1. host `verify` 加入**重連容錯**：收到的序號比 `last_seq` 低超過門檻（`SEQ_RESET_THRESHOLD=256`）→ 視為 client 計數器重置而非重放，放行；重放封包序號會貼近 `last_seq`、落在門檻內仍擋下。
  2. client `createPeerConnection` 每次新連線把 `controlSeqNumber`/`unreliableSeqNumber` 歸零，與 host 新 session 的 `last_seq=0` 對齊。
- **教訓**：
  - 單調遞增序號的重放防禦遇到「client 重連歸零 + host 狀態殘留」會反噬成 DoS；需明確區分「序號小幅回退＝重放」與「序號大幅歸零＝新連線」。
  - reliable 與 unreliable 兩通道序號體系獨立，是「移動正常、點擊失效」這類半失效症狀的共同結構（與先前 i64 panic 同型）。
  - iOS 特有：斷線不保證乾淨關閉 data channel/session，host 端狀態不能假設會隨斷線重置。

## 2026-07-03 — Android 鍵盤遮蓋輸入欄位（畫面未上移）

- **問題**：Android client 開啟虛擬鍵盤時畫面不上移，鍵盤蓋住輸入欄位（iOS 正常）。
- **根因**：`onViewportChange`（main.ts）對 Android 提早 `return`，假設 WebView 會**原生縮放 layout viewport** 自動讓內容上移。實測 Tauri Android WebView 不會自動上移 → 鍵盤直接遮擋。但同一函式已能用 `vv.height` 把 keyboard bar 正確定位在 `barTop`，證明 `visualViewport.height` 在 Android **確實會縮小**，手動平移的前提成立。
- **做法**：移除 Android 提早 return，改與 iOS 共用同一套手動平移邏輯（依 `kbFocusClientY` 算上移量、`applyVideoTransform`）；`kbFocusClientY` 為 -1 時退回 `innerHeight*0.45`（[main.ts:5392 附近](desktop/src/main.ts:5392)）。
- **教訓**：先前 DEVLOG 記載「Android 靠原生 viewport 縮放」是**未經實測的假設**，實際 Tauri Android WebView 行為需 `adjustResize` 才會自動上移，不能假定。visualViewport.height 有縮小 ≠ 內容會自動上移，兩者是獨立的。

## 2026-07-03 — 連線後點擊失效連鎖 bug（i64 溢位 panic）與 ⌘C/⌘V 修飾鍵

- **問題 1：連線後點擊 1~2 次就全部失效（滑鼠可移動，點擊/鍵盤全無反應，文字還跑到別的 app）**
  - 根因：`input.rs` macOS 連擊追蹤的 `LAST_CLICK_X/Y` 初始化為 `i64::MIN`，**第一次左鍵** `(px - lx).abs()` → `500 - i64::MIN` **整數溢位**。`./dev.sh` 走 `tauri dev`（debug profile），debug 模式整數溢位直接 **panic**，殺死 host `on_data_channel` 的 `input-control` on_message async task → 該可靠通道後續所有訊息（點擊、鍵盤）**靜默全丟**。滑鼠移動走另一條 `input-unreliable` 通道故不受影響；焦點停在最後一次成功點擊的視窗 → 打字跑到錯誤 app。
  - 做法：初始值改 `0`＋`last_ms > 0` 條件跳過首擊連擊判定；座標差改用 `i128` 計算 `unsigned_abs()` 徹底免溢位（[input.rs:347](core/src/input.rs:347)、[input.rs:513](core/src/input.rs:513)）。
- **問題 2：懸浮選單「複製」只送出「c」、「貼上」只送出「v」（修飾鍵沒生效）**
  - 根因：macOS 用 `CGEvent::new_keyboard_event` 合成的**修飾鍵按下不會自動讓後續按鍵繼承 flag**（與實體鍵盤不同）。host KeyDown 只是 post 鍵碼，Cmd down + C down 被當兩個獨立按鍵 → C 變純字元「c」。CLAUDE.md 記載的「host 忽略 modifiers byte、靠真實按住鍵碼」對合成事件不成立。
  - 做法：host 新增 4 個 `AtomicBool` 追蹤 Cmd/Shift/Alt/Ctrl 按住狀態，KeyDown/KeyUp 更新狀態並對每個按鍵 `event.set_flags(current_mod_flags())`；ResetState 清除狀態防殘留（[input.rs:352](core/src/input.rs:352)、[input.rs:611](core/src/input.rs:611)）。Windows `SendInput` 原生正確追蹤合成事件修飾鍵，不需改。
- **問題 3：client 看不到 remote 畫面變化（remote 實際有正確動作）**
  - 根因：iOS WKWebView 的 `<video>` 在背景切換/jitter buffer 清空/解碼器暫停後可能**靜默停止渲染但不觸發任何 pause/stall 事件**。先前把 `jitterBufferTarget=0` 壓到最低放大了此風險。
  - 做法：main.ts `ontrack` 加入凍結看門狗，每 2 秒檢查 `currentTime` 是否推進，凍結 ≥4s 或意外 `paused` 自動 `play()` 恢復；音訊軌道也補上 `jitterBufferTarget=0` 降延遲。
- **平台覆蓋**：問題 1、2 是 **macOS host 端** bug，iOS/Android 皆為 client，故 host 重編後任何 client 控制 macOS 時**一次同步修復**（非逐平台修）。問題 3 為 client WebView 端（main.ts），iOS/Android 共用同一 bundle，重建 client app 後皆生效；Android 鍵盤遮擋靠原生 viewport 縮放（[main.ts:5392](desktop/src/main.ts:5392)）故 `getFocusClientY` fallback 僅 iOS 用到。
- **教訓**：
  - 開發模式（debug profile）整數溢位是 **panic 不是 wrap**；靜態初值用 `i64::MIN` 當「哨兵值」再拿去做算術差值是地雷，改用 `Option`/`0 + 條件旗標`/`i128` 升位。
  - 單一 async task panic 會讓整條 data channel 靜默失效，症狀（點擊失效＋文字跑錯 app＋畫面像凍結）看似三個獨立 bug 實為一個根因。
  - macOS 合成鍵盤事件的修飾鍵必須**明確 set_flags**，不能靠「按住修飾鍵碼」；這與雙擊必須自帶 clickState 是同一類「CGEvent 不會幫你算狀態」陷阱。

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
