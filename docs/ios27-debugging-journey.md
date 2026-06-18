# iOS 27 黑屏 — 除錯歷程記錄（Debugging Journey）

> 記錄日期：2026-06-17 ~ 2026-06-18
> 對應結論與修法：見 [ios27-workaround.md](./ios27-workaround.md)
>
> 本文記錄「如何一步步把問題從 web 層一路追到 Apple UIScene 強制」的完整推理鏈，供日後遇到類似 iOS 黑屏／白屏時對照排查。

---

## 0. 初始症狀

- App 在 iPhone（iOS 27）上**全黑**，沒有任何 UI、沒有彈窗。
- Safari Web Inspector **能連上**，DOM 樹完整（含一個刻意加的滿版紅色 debug overlay 與開場 `alert()`），但畫面上什麼都看不到。

第一個反直覺點：**Inspector 看得到 DOM，但畫面全黑** → 表示 WKWebView 存在、HTML 已解析、JS context 活著，問題不在「有沒有載入」。

---

## 1. 把 web 層整個排除

| 假設 | 驗證 | 結果 |
|---|---|---|
| CSS（`-webkit-fill-available` / body 0 高）害的 | 主控台量 `window.innerWidth` | **`0 x 0`** → 是原生 webview 的 bounds，CSS 改不動 → 排除 CSS |
| `alert()` 沒彈代表 JS 沒跑 | 查 wry iOS 行為 | wry 的 iOS WKWebView **預設不呈現 JS alert** → alert 是誤導訊號，丟掉 |
| `position:fixed;inset:0` 的紅 overlay 應該滿版 | 量 overlay rect | 只有 40×40（padding 撐出）→ 視口本身是 0 |

**關鍵量測**（主控台）：

```js
{ innerW:0, innerH:0, docElClientH:0, htmlH:"0px", bodyH:"0px",
  overlayRect:{w:40,h:40}, bodyBg:"rgb(18,24,38)" }
```

→ 結論：**WKWebView 的原生 frame 是 0×0**，不是 web/CSS 問題。旋轉裝置也無法恢復。

---

## 2. 排除「本專案」嫌疑

逐一檢查、全部乾淨：

- 兩份 `tauri.conf.json`（含 `tauri.client.conf.json` override）— 無 width/height 或異常。
- `gen/apple` scene manifest（`TaoSceneDelegate`）— 存在且完整。
- `main.mm`、`lib.rs`（含 `run()`/`setup()`）— iOS 端無自訂視窗尺寸邏輯、無主執行緒阻塞、`#[cfg]` 正確排除桌面碼。
- `project.yml` 依賴 — 只有 Apple 系統 framework + `libapp.a`，無第三方原生 UI 庫。
- build 腳本 `build-ios-client.js` — 只是暫時換 config 再跑標準 `tauri ios build`。
- CLI（2.11.2）vs runtime（2.11.2）版本一致。

版本：`tauri 2.11.2 / tauri-runtime-wry 2.11.2 / wry 0.55.1 / tao 0.35.3`（皆為 crates.io 最新穩定版，`cargo update` 升不動）。

---

## 3. 試 wry/tao git 主線（失敗）

假設「新 iOS 的修正已進主線、只是還沒發版」：

```toml
[patch.crates-io]
wry = { git = "https://github.com/tauri-apps/wry" }   # 解析到 #2f768ae8
tao = { git = "https://github.com/tauri-apps/tao" }   # 解析到 #14ba5e96
```

可編譯（22s），但實機**仍 0×0**。→ 主線也沒有修正。（事後已還原 patch。）

---

## 4. 確認裝置真實版本（UA 是假的）

- `navigator.userAgent` 報 `iPhone OS 18_7` —— **WebKit 多年前就凍結了 UA 裡的 OS 版本**，不可信。
- 以「設定 → 關於本機」為準：**iPhone 16 Pro Max，iOS 27.0**。
- 工具鏈：Xcode 27.0 beta（27A5194q）/ iOS 27 SDK。

教訓：**iOS 版本一律以裝置「關於本機」或 crash log 的 `os_version` 為準，別信 webview UA。**

---

## 5. Minimal repro → 一槌定音

用全新 `npm create tauri-app`（vanilla）+ `tauri ios init`，灌到同一台 iOS 27 裝置：

- **stock 空專案直接 crash**（不是黑屏）。
- 從裝置拉 crash log（`idevicecrashreport`）分析：

```
Exception Type: EXC_BREAKPOINT (SIGTRAP)
OS Version:     iPhone OS 27.0 (24A5355q)

UIKitCore  ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke
UIKitCore  -[UIApplication workspace:didCreateScene:withTransitionContext:completion:]
...
<app>      tao::platform_impl::...::EventLoop::run
<app>      tauri_runtime_wry::Wry … Runtime::run
```

關鍵字 **`NoSceneLifecycleAdoption`** → **Apple 要求採用 UIScene 生命週期，iOS 27 將「未採用」升級為致命 trap。**

兩種表現差在 `Info.plist` 有沒有 scene manifest：

| | scene manifest | 結果 |
|---|---|---|
| stock 空專案 | 無（CLI 沒產生） | 啟動即 crash |
| 本專案 2syn | 有（`TaoSceneDelegate`） | 不 crash，但 WKWebView 0×0 → 黑屏 |

> 註：2syn 自己的 `.ips` 是 `SIGKILL`、停在 `tokio`/`parking_lot` Condvar::wait → 是被系統殺掉，不是啟動崩潰。

這也對齊全業界：React Native、Capacitor、Flutter、Unity、SDL、JUCE 都在處理同一個 Apple 變更。

---

## 6. 找豁免邊界：iOS 18 SDK，不是 iOS 26

- 一度以為「用正式版 Xcode 26（iOS 26.5 SDK）就豁免」。
- **用 iOS 26.5 模擬器 + Xcode 26.6 實測 → 一樣 0×0 黑屏。** 模擬器 log 顯示 app 跑在 `[rb-legacy]`（legacy 非 UIScene 生命週期），WebContent 有載入內容但不可見。
- 使用者回報「手機在 iOS 26 時 app 正常」→ 那個 build 是用**更舊的 Xcode（iOS 18 SDK）**編的。

→ 修正結論：**破壞從 iOS 26 SDK 就開始，唯一豁免的是 iOS 18 SDK（Xcode 16.x）。**

| 編譯 SDK | iOS 26/27 上 |
|---|---|
| iOS 18（Xcode 16） | ✅ 正常 |
| iOS 26.5（Xcode 26.6） | ❌ 0×0（實測） |
| iOS 27（Xcode 27 beta） | ❌ crash / 0×0 |

---

## 7. 工具鏈硬牆：Xcode 16 跑不了 macOS 26

要 iOS 18 SDK 就得用 Xcode 16，但這台是 **macOS 26（Tahoe）**：

```
CompileAssetCatalog … failed
Failed to handshake with platform tool
AssetCatalogSimulatorAgent exited before we could handshake
```

`actool` 的 helper agent 在 macOS 26 啟動即崩潰（已排除 quarantine／first-launch）。Apple 只保證 Xcode 在同代／前一代 macOS 運作，Xcode 16（2024）對 macOS 26 超出兩代。

→ **本機（macOS 26）無法編出可在 iOS 27 顯示的 build**：Xcode 26/27 的 SDK 會 0×0，Xcode 16 的 actool 跑不動。

（過程中也踩到：正式 Xcode 無法 `tauri ios dev` 直接跑比它新的 iOS 裝置；新裝的 Xcode 要 `xcodebuild -downloadPlatform iOS` 補平台元件；`tauri ios build` 不帶 `-destination`，缺平台時會報 `Found no destinations`。）

---

## 8. 決定

採 **選項 A**：接受 iOS 27 暫不支援，等 `tao` 採用 UIScene 後用現行 Xcode 直接編。真實使用者（穩定版 iOS）不受影響；黑屏僅限手上的 iOS 27 beta 測試機。

追蹤：[tauri-apps/tao issues](https://github.com/tauri-apps/tao/issues) ／ [tauri-apps/tauri issues](https://github.com/tauri-apps/tauri/issues)。
tao 一發布 UIScene 支援 → `cargo update -p tao -p wry` + Xcode 26/27 重編即可。

---

## 速查：本案用到的診斷指令

```bash
# 從裝置拉 crash log
idevicecrashreport -k -e /tmp/crash

# 解析 .ips（header 為第一行 JSON、其後為 body JSON）
python3 -c "import json;raw=open('x.ips').read();b=json.loads(raw.split('\n',1)[1]);..."

# 模擬器：啟動 app、截圖、撈 log
xcrun simctl launch booted <bundleid>
xcrun simctl io booted screenshot /tmp/a.png
xcrun simctl spawn booted log show --last 2m --style compact | grep -i scene

# 查可用 SDK / 模擬器 runtime / 建置目的地
xcodebuild -showsdks
xcrun simctl list runtimes
xcodebuild -showdestinations -scheme <scheme> -workspace <ws>

# 補下載平台（針對「<ver> is not installed」）
xcodebuild -downloadPlatform iOS
```
