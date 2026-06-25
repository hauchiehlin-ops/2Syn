# iOS 27 全黑畫面 — 根因與 workaround

> ⚠️ **2026-06-25 重大更正：以下舊結論是錯的。真正根因是 `Info.plist` 設定錯誤，不是 tao 不支援 UIScene。**
>
> ## ✅ 正確根因與修法（請先讀這段）
>
> tao 0.35.3 **完整實作了 `TaoSceneDelegate` 與 UIScene 生命週期**（見 `tao/src/platform_impl/ios/scene.rs`、`app_state.rs::connect_scene`、`view.rs::create_window`）。問題出在本專案的 scene manifest 設定矛盾：
>
> - `gen/apple/syn-desktop_iOS/Info.plist` 有 `UIApplicationSceneManifest`（指向 `TaoSceneDelegate`）→ iOS 以 **scene 生命週期**渲染。
> - 但其中 `UIApplicationSupportsMultipleScenes` 被設為 **`false`**。
> - tao 的 `create_window` **只有在 `multiple_scenes_enabled()`（讀此旗標）為 true 時，才會把 `UIWindow` 掛上 `UIWindowScene`**。旗標為 false → window 沒掛任何 scene → **WKWebView 拿到 0×0、全黑、`innerWidth=0`**。
> - 這與 iOS 版本、編譯 SDK **完全無關**：只要 manifest 在、此旗標為 false，**任何 iOS（含 26 穩定版）都會黑**。這正是「iOS 26 也黑」的原因。
>
> **修法：把 `UIApplicationSupportsMultipleScenes` 改成 `true`。**（已同步寫入來源 `src-tauri/Info.ios.plist` 與產生檔 `gen/apple/.../Info.plist`。）
>
> **連帶結論：下面整套「必須用 iOS 18 SDK / Xcode 16、macOS 26 編不出來、只能等上游」的 workaround 已不需要。** 用現行 Xcode/SDK 直接編即可正常顯示。當初 git-main 測試「仍 0×0」是因為用了同一份錯誤的 Info.plist，與 tao 版本無關。
>
> ---
>
> <details>
> <summary>以下為 2026-06-17 的舊結論（已證實誤判，保留供歷史對照）</summary>

> 建立日期：2026-06-17
> 影響範圍：iOS 26 / iOS 27（含 beta）裝置上的 client app
> 結論：~~這是 Tauri/tao 對 Apple「UIScene 生命週期強制採用」尚未支援的框架相容問題，與本專案程式碼無關。~~ **（已更正：見上方）**
> 完整除錯推理鏈：見 [ios27-debugging-journey.md](./ios27-debugging-journey.md)

---

## TL;DR

- iOS 26 起、iOS 27 強制執行：app 必須採用 **UIScene 生命週期**。用 iOS 26+ SDK 編譯卻沒正確採用的 app 會被 UIKit **致命中止**。
- Tauri 的 **tao 0.35.3** 還沒為新 SDK 正確採用 UIScene，於是在 iOS 27 上：
  - **沒有 scene manifest 的 app** → 啟動即 crash（`EXC_BREAKPOINT`，`NoSceneLifecycleAdoption`）。
  - **有 scene manifest 的 app（本專案）** → 不 crash，但 WKWebView 拿到 **0×0** frame → **全黑畫面**。
- **暫時解法**：用 **iOS 18 SDK（Xcode 16.x）** 編譯，透過 **TestFlight** 安裝到 iOS 27 裝置（舊 SDK 連結 = 豁免致命強制）。
  - ⚠️ **iOS 26 SDK（Xcode 26）並不豁免**——已實測：用 Xcode 26.6（iOS 26.5 SDK）編、在 iOS 26.5 模擬器上仍 0×0 黑屏。破壞從 iOS 26 SDK 就開始，唯一可用的是 **iOS 18 SDK（Xcode 16.x）**。
- **真正解法**：等上游 tao/Tauri 發布支援 UIScene 的版本。crates.io 穩定版與 git 主線（截至 2026-06-17）皆尚未修正。
- **跑穩定版 iOS（≤26）、用正式版 Xcode 出貨的真實使用者不受影響。**

---

## 症狀

- App 在 iOS 27 裝置上**全黑**，沒有任何 UI。
- Safari Web Inspector **能連上**，DOM 完整、JS 正常執行、`setInterval` 持續運作。
- 主控台量測：

  ```js
  window.innerWidth + ' x ' + window.innerHeight   // => "0 x 0"
  getComputedStyle(document.body).height            // => "0px"
  ```

- 旋轉裝置**無法**讓畫面恢復。
- 純內聯的 `position:fixed; inset:0` 紅色 overlay 也畫不出來。

> 為何「web 層全部排除」：`window.innerWidth === 0` 是 JS 直接讀到的**原生 WKWebView bounds**，CSS 改不動它。WKWebView 的 JS 跑在獨立的 WebContent 行程，所以即使原生 view 是 0×0、Inspector 仍連得上、JS 仍會跑。

---

## 根因

Apple 自 iOS 26 起要求採用 UIScene 生命週期，iOS 27 將其升級為**致命**（以前僅 console warning）。這是全業界的變更，React Native、Capacitor、Flutter、Unity、SDL、JUCE 都在處理同一件事。

本專案的 minimal repro（全新 `npm create tauri-app` 空專案 + `tauri ios init`）在同一台 iOS 27 裝置上**直接 crash**，證明問題在框架而非本專案。兩種表現的差異來自 `Info.plist` 是否含 `UIApplicationSceneManifest`：

| | scene manifest | iOS 27 結果 |
|---|---|---|
| 全新 stock Tauri app | 無（CLI 未產生） | `NoSceneLifecycleAdoption` trap → **啟動即 crash** |
| 本專案 2syn | 有（`TaoSceneDelegate`） | 通過採用檢查、不 crash，但 tao 的 window 設定在新 SDK 下 → **WKWebView 0×0 → 黑屏** |

### Crash backtrace（minimal repro，iOS 27.0）

```
Exception Type:  EXC_BREAKPOINT (SIGTRAP)
OS Version:      iPhone OS 27.0 (24A5355q)

Triggered thread (com.apple.main-thread):
  UIKitCore            ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke
  libdispatch.dylib    _dispatch_once_callout
  UIKitCore            -[UIApplication workspace:didCreateScene:withTransitionContext:completion:]
  UIKitCore            -[UIApplicationSceneClientAgent scene:didInitializeWithEvent:completion:]
  FrontBoardServices   -[FBSScene _callOutQueue_didCreateWithTransitionContext:...]
  ...
  CoreFoundation       __CFRunLoopRun
  UIKitCore            UIApplicationMain
  <app>                tao::platform_impl::platform::event_loop::EventLoop<T>::run
  <app>                tauri_runtime_wry::Wry<T> as tauri_runtime::Runtime<T>>::run
  <app>                tauri::app::App<R>::run
  <app>                <app>_lib::run
  <app>                start_app / main
```

關鍵 frame：**`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`** → UIKit 在 scene 建立時判定「此 process 未採用 UIScene 生命週期」並 trap。

> 註：本專案 2syn 自己的 `.ips` crash 報告是 `EXC_CRASH / SIGKILL`，執行緒停在 `parking_lot` / `tokio` 的 `Condvar::wait` —— 那是被系統**殺掉**（背景/watchdog），**不是啟動崩潰**。2syn 啟動時不 crash，只是黑屏。

### 受影響版本（確認當下）

| 元件 | 版本 |
|---|---|
| tauri | 2.11.2 |
| tauri-runtime-wry | 2.11.2 |
| wry | 0.55.1（git 主線 commit `2f768ae8` 亦無修正） |
| tao | 0.35.3（git 主線 commit `14ba5e96` 亦無修正） |
| 裝置 | iPhone 16 Pro Max — iOS 27.0 (24A5355q) |
| beta 工具鏈 | Xcode 27.0 (27A5194q) / iOS 27 SDK ← **會壞**（crash / 0×0） |
| 正式工具鏈 | Xcode 26.6 (17F109) / iOS 26.5 SDK ← **也會壞**（0×0，模擬器實測） |
| 可用工具鏈 | Xcode 16.x / iOS 18 SDK ← **唯一可用**（豁免） |

---

## 排除過程（供日後對照，皆已排除）

- CSS / `-webkit-fill-available`：無辜（CSS 改不動 `innerWidth`）。
- `alert()` 不彈：Tauri/wry 的 iOS WKWebView 預設不呈現 JS alert，與本問題無關。
- 兩份 `tauri.conf.json`（含 client override）、scene manifest、CLI/runtime 版本、自訂原生碼、build 腳本、連結的原生庫：全部乾淨。
- `cargo update`：tauri/wry/tao 已是最新穩定版，無可升。
- `[patch.crates-io]` 指向 wry/tao git 主線：可編譯，但實機**仍 0×0**（主線尚無修正）。

---

## Workaround：用 iOS 18 SDK（Xcode 16.x）編譯 + TestFlight 安裝

致命強制是綁「編譯時連結的 SDK」。**只有用 iOS 18 SDK（Xcode 16.x）** 編出來的 app 回到舊行為、WKWebView 正常取得尺寸。

### 實測：各 SDK 在 iOS 26/27 上的結果

| 編譯 SDK（Xcode） | iOS 26.x | iOS 27.x | 狀態 |
|---|---|---|---|
| iOS 18（Xcode 16.x） | 正常 | 正常 | ✅ 唯一可用（升級 beta 前的原本工具鏈） |
| iOS 26.5（Xcode 26.6） | **0×0 黑屏**（模擬器實測） | 0×0 黑屏 | ❌ |
| iOS 27（Xcode 27 beta） | — | 黑屏 / crash | ❌ |

### Catch-22 與對策

| 工具鏈 | 能 deploy 到 iOS 27 實機？ | 用的 SDK | 結果 |
|---|---|---|---|
| Xcode 27 beta | ✅ | iOS 27（致命強制） | 黑屏 / crash |
| Xcode 16.x 正式 | ❌（正式 Xcode 撐不到比它新的裝置 OS） | iOS 18（豁免） | 可用，但不能用 `tauri ios dev` 直接跑 iOS 27 實機 |

→ **用 Xcode 16.x「建置」，透過 TestFlight「安裝」**（TestFlight 不受 Xcode 版本 vs 裝置 OS 限制）。本機開發則用 **iOS 18 模擬器**。

### 1. 安裝並切換到 Xcode 16.x（與 beta／26 並存）

```bash
# 從 https://developer.apple.com/download/all/ 下載 Xcode 16.x，放到 /Applications/Xcode_16.app
# （保留 /Applications/Xcode-beta.app 與 /Applications/Xcode.app）

sudo xcode-select -s /Applications/Xcode_16.app/Contents/Developer
sudo xcodebuild -license accept

xcode-select -p                                # 應為 /Applications/Xcode_16.app/...
xcrun --sdk iphoneos --show-sdk-version         # 應為 18.x（這才是豁免的 SDK）
```

### 2. 補下載 iOS 18 平台支援（含模擬器 runtime）

全新安裝的 Xcode 常缺平台元件，會出現
`iOS 18.x is not installed. Please download and install the platform from Xcode > Settings > Components`。

```bash
xcodebuild -downloadPlatform iOS          # 或 Xcode → Settings → Components 手動下載（數 GB）
xcrun simctl list runtimes                # 完成後應出現 iOS 18.x runtime
```

### 3. 清掉 beta SDK 殘留

```bash
cd ~/GitProjects/2syn/desktop
rm -rf src-tauri/gen/apple/build
rm -rf ~/Library/Developer/Xcode/DerivedData/*
```

### 4a. 本機快速驗證（模擬器）

**先拔除 iOS 27 實體 iPhone**（避免 xcodebuild 鎖定不合格裝置導致 `Found no destinations`）。

```bash
LANG=en_US.UTF-8 npm run tauri:dev:ios:client    # 列表選「iOS 18」的模擬器
```

畫面正常顯示 → 確認豁免有效。

> ⚠️ 用 iOS 26 模擬器（iOS 26.5 SDK）驗證會誤導——已實測仍為 0×0 黑屏。一定要用 **iOS 18** 模擬器。

### 4b. 出貨給 iOS 27 實機（TestFlight）

一樣**先拔除實體 iPhone**，建 generic 封存：

```bash
LANG=en_US.UTF-8 npm run tauri:build:ios:client:appstore
# 產出的 .ipa（iOS 26.5 SDK、已豁免）上傳 TestFlight，再到 iOS 27 手機安裝
```

> 只在單次建置切 SDK、不改全域預設：
> `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer LANG=en_US.UTF-8 npm run tauri:build:ios:client:appstore`

---

## ⚠️ 重要：macOS 26 上無法本機建 iOS 18 SDK 版

唯一豁免的 SDK 是 iOS 18（Xcode 16），但 **Xcode 16 無法在 macOS 26（Tahoe）上正常運作**：

```
CompileAssetCatalog … failed
Failed to handshake with platform tool
AssetCatalogSimulatorAgent exited before we could handshake
Recovery Suggestion: Try restarting your computer
```

`actool` 的 helper agent（用到系統私有框架）在 macOS 26 啟動即崩潰（非 quarantine、非 first-launch 問題，已排除）。Apple 一般只保證 Xcode 在同代／前一代 macOS 運作，Xcode 16（2024）對 macOS 26（2025）超出兩代。

→ **在 macOS 26 機器上，沒有任何本機 Xcode 組合能編出可在 iOS 27 顯示的 build**（Xcode 26/27 的 SDK 會 0×0；Xcode 16 的 actool 跑不動）。

### 對策

- **A（推薦）**：接受 iOS 27 暫不支援，等 tao 採用 UIScene 後用現行 Xcode 直接編。真實使用者（穩定版 iOS）不受影響。
- **B**：在 **CI（GitHub Actions `macos-15` + Xcode 16）或一台 macOS ≤15 的 Mac** 上，用 iOS 18 SDK 編出 .ipa → TestFlight。
- **C（不建議）**：自行 patch tao 採用 UIScene。

> 因此上面「Workaround」章節的本機 `tauri ios build` 步驟，只在 **macOS ≤15 + Xcode 16** 的機器上適用；在 macOS 26 上會卡在 actool。

## 注意事項

- **正式版/TestFlight 一律用正式版 Xcode 出**，否則一樣會中 iOS 27 SDK 的致命強制。
- 不建議手動在 `gen/apple` 塞自訂 SceneDelegate：本專案已有 scene manifest 卻仍 0×0，代表光採用不夠，tao 內部的 window/webview sizing 也要一起改，手改既深又脆。
- 待 tao/Tauri 發布支援 UIScene 的版本後，即可改回 beta/最新 SDK 正常支援 iOS 27。

---

## 長期解法（追蹤上游）

tao 需要完整採用 UIScene 生命週期。請追蹤：

- tao issues：https://github.com/tauri-apps/tao/issues
- tauri issues：https://github.com/tauri-apps/tauri/issues

## 參考

- Apple：採用 UIScene 生命週期（業界通用變更）
- Capacitor #7961 — "does not adopt UIScene lifecycle. This will become an assert in a future version"：https://github.com/ionic-team/capacitor/issues/7961
- React Native #53602 — crash with SceneDelegate (Xcode 26)：https://github.com/react/react-native/issues/53602
- Flutter — UISceneDelegate adoption（breaking change）：https://docs.flutter.dev/release/breaking-changes/uiscenedelegate

</details>

---

## 附註：那個「stock 空專案 crash」是另一回事

舊除錯記錄裡「全新 `npm create tauri-app` 空專案在 iOS 27 直接 crash（`NoSceneLifecycleAdoption`）」是**真的**，但那是**沒有任何 scene manifest** 的情況。2syn 有 manifest，所以不 crash；2syn 的問題單純是 manifest 裡 `UIApplicationSupportsMultipleScenes=false`。兩者是不同症狀：

| 情況 | scene manifest | `SupportsMultipleScenes` | iOS 27 結果 |
|---|---|---|---|
| stock 空專案 | 無 | — | `NoSceneLifecycleAdoption` crash |
| 2syn（修正前） | 有 | `false` | 不 crash，但 0×0 黑屏 |
| 2syn（修正後） | 有 | `true` | ✅ 正常顯示 |
