import { invoke, isTauri } from "@tauri-apps/api/core";
import { setupFileTransferDropZone } from "./file_transfer";
import { I18N_HELP_DOCS } from "./help_i18n";
import { open } from "@tauri-apps/plugin-shell";
import { listen } from "@tauri-apps/api/event";
import pkg from "../package.json";

// =============================================================================
// HUD 自檢心跳：放在模組最頂端、與所有初始化/連線/getStats 解耦，
// 確保即使後續任何頂層程式碼在某些 WebView 拋錯中斷求值，setInterval 也已註冊。
// 純粹確認「手機運行的就是最新打包」，並顯示打包時間戳以資辨識。
// 真正的診斷數據開始輸出時（logDiag 設 dataset.live）即讓出畫面。
// =============================================================================
(function diagBootstrapHeartbeat() {
  const BUILD_TAG = "BUILD-" + new Date().toISOString().slice(5, 19).replace("T", " ");
  let n = 0;
  const tick = () => {
    n++;
    const root = document.body || document.documentElement;
    if (!root) return;
    let hud = document.getElementById("diag-hud");
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "diag-hud";
      hud.style.cssText = "position:fixed;top:max(env(safe-area-inset-top),8px);left:8px;z-index:2147483647;max-width:94vw;background:rgba(0,0,0,0.66);color:#7dd3fc;font-family:ui-monospace,monospace;font-size:10px;line-height:1.45;padding:6px 8px;border-radius:8px;pointer-events:none;white-space:pre-wrap;";
      root.appendChild(hud);
    }
    if (!hud.dataset.live) {
      hud.textContent = `HUD 自檢 ${BUILD_TAG} #${n}`;
    }
  };
  tick();
  setInterval(tick, 1000);
})();

function isDesktopTauri(): boolean {
  if (!isTauri()) return false;
  const ua = navigator.userAgent.toLowerCase();
  
  // 排除明確的行動端 UA 關鍵字
  const isMobileUA = /iphone|ipad|ipod|android/.test(ua);
  if (isMobileUA) return false;
  
  // iPadOS 模擬 macOS 桌面 UA，但仍擁有多點觸控
  // 真正的 Mac/Windows 桌面也可能有觸控螢幕 (Surface/iMac Touch)
  // 因此僅針對 "Macintosh" + maxTouchPoints > 2 的情況判定為 iPadOS
  const isMac = /macintosh/.test(ua);
  if (isMac && navigator.maxTouchPoints > 2) return false;
  
  return true;
}

// --- Toast Notification System ---
function showToast(message: string, duration: number = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// --- Debug Console Interceptor ---
function translateLogMessage(msg: string, tFunc: (key: string) => string): string {
  const translateStatus = (status: string) => {
    const clean = status.trim().toLowerCase();
    const map: Record<string, string> = {
      "connected": tFunc("log_status_connected"),
      "disconnected": tFunc("log_status_disconnected"),
      "checking": tFunc("log_status_checking"),
      "completed": tFunc("log_status_completed"),
      "completed.": tFunc("log_status_completed"),
      "stable": tFunc("log_status_stable"),
      "failed": tFunc("log_status_failed"),
      "failed.": tFunc("log_status_failed"),
      "connecting": tFunc("log_status_connecting"),
      "gathering": tFunc("log_status_gathering"),
      "checking.": tFunc("log_status_checking"),
      "closed": tFunc("log_status_closed"),
      "closed.": tFunc("log_status_closed"),
      "new": tFunc("log_status_new"),
      "video": tFunc("log_status_video"),
      "audio": tFunc("log_status_audio")
    };
    return map[clean] || status;
  };

  // 1. WebRTC Track Event
  if (msg.includes("[WebRTC] 收到遠端視訊軌道:") || msg.includes("[WebRTC] Received remote track:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return tFunc("log_webrtc_received_track").replace("{0}", translateStatus(val));
  }
  // 2. WebRTC ICE Connection State
  if (msg.includes("[WebRTC] ICE Connection State:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return tFunc("log_webrtc_ice_state").replace("{0}", translateStatus(val));
  }
  // 3. WebRTC Connection State
  if (msg.includes("[WebRTC] Connection State:") || msg.includes("[WebRTC] 連線狀態:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return tFunc("log_webrtc_conn_state").replace("{0}", translateStatus(val));
  }
  // 4. WebRTC ICE Gathering State
  if (msg.includes("[WebRTC] ICE Gathering State:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return tFunc("log_webrtc_gather_state").replace("{0}", translateStatus(val));
  }
  // 5. WebRTC Signaling State
  if (msg.includes("[WebRTC] Signaling State:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return tFunc("log_webrtc_sig_state").replace("{0}", translateStatus(val));
  }
  // 6. WebRTC Negotiation Needed
  if (msg.includes("[WebRTC] Negotiation Needed") || msg.includes("[WebRTC] 需要協商")) {
    return tFunc("log_webrtc_negotiation");
  }
  // 7. Video Playback Error
  if (msg.includes("[WebRTC] 視訊播放失敗:") || msg.includes("[WebRTC] Video Playback Failed:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return tFunc("log_webrtc_play_failed").replace("{0}", val);
  }
  // 8. Rust Signaling State
  if (msg.includes("[WebRTC-Rust] 狀態變更:") || msg.includes("[WebRTC-Rust] State Changed:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return tFunc("log_webrtc_rust_state").replace("{0}", val);
  }
  // 9. Host Video Capture Status
  if (msg.includes("[WebRTC-Video] 影像處理發生問題:") || msg.includes("[WebRTC-Video] Video capture/encode error:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return tFunc("log_webrtc_video_error").replace("{0}", val);
  }
  // 10. Video Encoding Size
  if (msg.includes("[Video] Encoded frame size:")) {
    const match = msg.match(/Encoded frame size:\s*(\d+)/i);
    if (match) {
      return tFunc("log_video_encoded_frame").replace("{0}", match[1]);
    }
  }
  // 11. Video Send Failed
  if (msg.includes("[Video] 傳送視訊幀失敗:") || msg.includes("[Video] Failed to send frame:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return tFunc("log_video_send_failed").replace("{0}", val);
  }
  // 12. Video Send Timeout
  if (msg.includes("[Video] 傳送視訊幀逾時 (網路擁塞)") || msg.includes("[Video] Frame transmission timed out")) {
    return tFunc("log_video_send_timeout");
  }
  // 13. Input Simulation Error
  if (msg.includes("[input-control] simulate failed:")) {
    const val = msg.split("failed:").slice(1).join("failed:").trim();
    return tFunc("log_input_simulate_failed").replace("{0}", val);
  }
  // 14. Input Security Packet Rejected
  if (msg.includes("[security input-control] packet rejected:")) {
    const val = msg.split("rejected:").slice(1).join("rejected:").trim();
    return tFunc("log_input_rejected").replace("{0}", val);
  }
  // 15. Unreliable Input Simulation Error
  if (msg.includes("[input-unreliable] simulate failed:")) {
    const val = msg.split("failed:").slice(1).join("failed:").trim();
    return tFunc("log_input_unreliable_failed").replace("{0}", val);
  }

  // 16. Rust 信令：連線請求收到
  if (msg.includes("收到來自") && msg.includes("的 Offer，進行驗證")) {
    const match = msg.match(/收到來自 (.+?) 的 Offer/);
    const id = match ? match[1] : "?";
    return tFunc("log_sig_rust_offer_received").replace("{0}", id);
  }
  // 17. Rust 信令：成功回傳 Answer
  if (msg.includes("成功處理 Offer，正在回傳 Answer 至")) {
    const match = msg.match(/回傳 Answer 至 (.+?)\.\.\./);
    const id = match ? match[1] : "?";
    return tFunc("log_sig_rust_offer_success").replace("{0}", id);
  }
  // 18. Rust 信令：拒絕連線
  if (msg.includes("拒絕來自") && msg.includes("的連線：")) {
    const match = msg.match(/拒絕來自 (.+?) 的連線：(.+)/);
    const id = match ? match[1] : "?";
    const reason = match ? match[2] : "";
    return tFunc("log_sig_rust_offer_rejected").replace("{0}", id).replace("{1}", reason);
  }
  if (msg.includes("PIN 碼或固定密碼不符")) {
    const match = msg.match(/來自 (.+?) 的連線/);
    const id = match ? match[1] : "?";
    return tFunc("log_sig_rust_offer_rejected").replace("{0}", id).replace("{1}", "PIN mismatch");
  }
  // 19. Rust 信令：ICE 候選收到
  if (msg.includes("收到來自") && msg.includes("的 ICE Candidate，套用中")) {
    const match = msg.match(/收到來自 (.+?) 的 ICE/);
    const id = match ? match[1] : "?";
    return tFunc("log_sig_rust_ice_received").replace("{0}", id);
  }
  // 20. Rust 信令：ICE 套用成功
  if (msg.includes("已成功加入遠端 ICE Candidate")) {
    return tFunc("log_sig_rust_ice_applied");
  }
  // 21. Rust 信令：ICE 套用失敗
  if (msg.includes("套用 ICE Candidate 失敗:")) {
    const val = msg.split("失敗:").slice(1).join("失敗:").trim();
    return tFunc("log_sig_rust_ice_failed").replace("{0}", val);
  }
  // 22. Rust 信令：心跳超時
  if (msg.includes("心跳接收超時") || msg.includes("主動判定斷線")) {
    return tFunc("log_sig_rust_watchdog");
  }
  // 23. Rust 信令：自癒機制
  if (msg.includes("自動重連自癒以更新路由")) {
    return tFunc("log_sig_rust_selfheal");
  }
  // 24. Rust 信令：ICE 轉發
  if (msg.includes("Rust 信令已發送本機 ICE Candidate 至")) {
    const match = msg.match(/至 (.+)/);
    const id = match ? match[1] : "?";
    return tFunc("log_sig_rust_forward_candidate").replace("{0}", id);
  }
  // 25. Rust 收到 9 個 ICE Candidate（批次）
  if (msg.includes("個 ICE Candidate，套用中")) {
    const match = msg.match(/收到 (\d+) 個/);
    const count = match ? match[1] : "?";
    return tFunc("log_sig_rust_ice_received").replace("{0}", count + " candidates");
  }
  // 26. Gesture：單指長按
  if (msg.includes("單指長按，觸發右鍵點擊與震動") || msg.includes("[Gesture] Long press")) {
    return "[Gesture] " + tFunc("log_gesture_long_press");
  }
  // 27. Gesture：觸控被取消
  if (msg.includes("觸控被取消，重置狀態，釋放滑鼠按鍵") || msg.includes("[Gesture] Touch cancelled")) {
    return "[Gesture] " + tFunc("log_gesture_cancelled");
  }
  // 28. Input：失去焦點，發送 ResetState
  if (msg.includes("失去焦點或切換分頁，發送 ResetState") || msg.includes("[Input] Focus lost")) {
    return "[Input] " + tFunc("log_input_focus_lost");
  }
  // 29. Pointer Lock：鎖定
  if (msg.includes("滑鼠指標已鎖定") || msg.includes("[Pointer Lock] Locked")) {
    return "[Pointer Lock] " + tFunc("pointer_lock_tooltip");
  }
  // 30. Pointer Lock：解鎖
  if (msg.includes("滑鼠指標已解鎖") || msg.includes("[Pointer Lock] Unlocked")) {
    return "[Pointer Lock] " + tFunc("log_status_disconnected");
  }
  // 31. Signaling：手動重連
  if (msg.includes("使用者手動觸發信令重連") || msg.includes("User manually triggered")) {
    return "[Signaling] " + tFunc("log_sig_manual_reconnect");
  }
  // 32. Signaling：已連線，正在登入
  if (msg.includes("已連線，正在登入") || msg.includes("Connected, logging in")) {
    return "[Signaling] " + tFunc("log_sig_connected_logging_in");
  }
  // 33. Signaling：WebSocket 斷線重試
  if (msg.includes("WebSocket 已斷線，5 秒後重新嘗試") || msg.includes("WebSocket disconnected, retrying")) {
    return "[Signaling] " + tFunc("log_sig_disconnected_retry");
  }
  // 34. Signaling：連線錯誤
  if (msg.includes("[Signaling] 連線錯誤:") || msg.includes("[Signaling] Connection error:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return "[Signaling] " + tFunc("log_sig_connection_error").replace("{0}", val);
  }
  // 35. Signaling：伺服器錯誤
  if (msg.includes("[Signaling] 伺服器錯誤:") || msg.includes("[Signaling] Server error:")) {
    const val = msg.split(":").slice(1).join(":").trim();
    return "[Signaling] " + tFunc("log_sig_server_error").replace("{0}", val);
  }
  // 36. Signaling Rust：嘗試連線
  if (msg.includes("[Rust] 嘗試連線至信令伺服器")) {
    return tFunc("log_sig_rust_connecting");
  }
  // 37. Signaling Rust：已成功連線
  if (msg.includes("[Rust] 已成功連線並登入信令伺服器")) {
    return tFunc("log_sig_rust_connected");
  }
  // 38. Signaling Rust：斷線重試
  if (msg.includes("[Rust] 與信令伺服器連線已斷開")) {
    return tFunc("log_sig_rust_disconnected");
  }
  // 39. Signaling Rust：委託啟動
  if (msg.includes("已成功委託 Rust 後端啟動信令客戶端")) {
    return tFunc("log_sig_rust_start_success");
  }
  // 40. Signaling Rust：啟動失敗
  if (msg.includes("啟動 Rust 信令失敗:")) {
    const val = msg.split("失敗:").slice(1).join("失敗:").trim();
    return tFunc("log_sig_rust_start_failed").replace("{0}", val);
  }
  // 41. Tauri 桌面環境偵測
  if (msg.includes("偵測為 Tauri 桌面環境，註冊 Rust 後端信令維護")) {
    return "[Signaling] " + tFunc("log_sig_tauri_rust_delegation");
  }
  // 42. 網頁控制端焦點重連
  if (msg.includes("網頁控制端獲得焦點，且信令未連線，立即重建連線")) {
    return "[Signaling] " + tFunc("log_sig_web_focus_reconnect");
  }
  // 43. 網頁控制端焦點 ping
  if (msg.includes("網頁控制端獲得焦點，發送 ping 驗證連線")) {
    return "[Signaling] " + tFunc("log_sig_web_focus_ping");
  }
  // 44. 網頁控制端頁面恢復可見
  if (msg.includes("網頁控制端頁面恢復可見，且信令未連線，立即重建連線")) {
    return "[Signaling] " + tFunc("log_sig_web_visible_reconnect");
  }
  // 45. Rust WebSocket
  if (msg.includes("[Rust] 已成功建立 WebSocket 連線") || msg.includes("[Rust] Successfully established WebSocket")) {
    return tFunc("log_rust_ws_connected");
  }
  // 46. Rust Login Success
  if (msg.includes("[Rust] 登入成功，ID:")) {
    const match = msg.match(/ID: (.+)/);
    const id = match ? match[1] : "?";
    return tFunc("log_rust_login_success").replace("{0}", id);
  }

  return msg;
}

(function() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  
  function formatArg(a: any) {
    if (a instanceof Error) {
      return `${a.name}: ${a.message}\n${a.stack}`;
    }
    return typeof a === 'object' ? JSON.stringify(a) : String(a);
  }

  function appendLog(color: string, args: any[], isError = false) {
    if (isError) originalError.apply(console, args);
    else originalLog.apply(console, args);
    // Ensure this runs only in browser context (when DOM is available)
    if (typeof document !== 'undefined') {
      const overlay = document.getElementById('debug-overlay');
      if (!overlay) return;

      const rawMsg = args.map(formatArg).join(' ');
      let msg = rawMsg;
      
      // 動態翻譯顯示在系統日誌面板上的訊息
      try {
        const tFunc = (window as any).t || ((key: string) => fallbackTranslations[key] || key);
        msg = translateLogMessage(msg, tFunc);
      } catch (err) {
        // 忽略翻譯過程中的任何意外錯誤，以原樣輸出日誌
      }

      const line = document.createElement('div');
      line.style.color = color;
      const timestamp = new Date().toISOString().split('T')[1].slice(0,-1);
      line.textContent = `[${timestamp}] ${msg}`;
      
      // 在 DOM 上快取原始訊息、時間戳與顏色，供多國語言切換時即時重譯重繪
      line.dataset.originalMsg = rawMsg;
      line.dataset.timestamp = timestamp;
      line.dataset.color = color;
      
      overlay.appendChild(line);

      while (overlay.children.length > 100) {
        overlay.removeChild(overlay.firstChild!);
      }
      overlay.scrollTop = overlay.scrollHeight;

      // 如果是 Error，且畫面上有 toast-container，則彈出提示
      if (isError) {
        // 使用 t() 取得多國語系字串
        const toastMsg = typeof (window as any).t === "function" ? (window as any).t("toast_system_error") : "⚠️ System Error: Open Advanced Panel to view logs";
        showToast(toastMsg, 5000);
      }
    }
  }
  
  console.log = (...args) => appendLog('#0f0', args);
  console.warn = (...args) => appendLog('#ff0', args);
  console.error = (...args) => appendLog('#f00', args, true);
})();
// ---------------------------------

// =========================================================================
// WebRTC 信令與 P2P 連線全域狀態
// =========================================================================
let signalingWs: WebSocket | null = null;
let peerConnection: RTCPeerConnection | null = null;
let videoScale = 1;
let videoTranslateX = 0;
let videoTranslateY = 0;
let keyboardOffsetUpdateY = 0;
let isLocalPinching = false;
let pinchStartScale = 1;
let pinchStartTx = 0;
let pinchStartTy = 0;
let pinchStartCx = 0;
let pinchStartCy = 0;
let warpX = 0;
let warpY = 0;

function applyVideoTransform() {
  const video = document.getElementById("remote-video") as HTMLVideoElement;
  if (!video) return;
  const finalY = videoTranslateY + keyboardOffsetUpdateY;
  // 用 translate3d 強制 GPU 合成層，避免平移時掉出合成層導致畫面抖動/卡頓（參考 Chrome Remote Desktop 的穩定平移）
  video.style.transform = `translate3d(${videoTranslateX + warpX}px, ${finalY + warpY}px, 0) scale(${videoScale})`;
}

function triggerHaptic(type: "light" | "medium" | "heavy") {
  if (typeof navigator.vibrate === "function") {
    if (type === "light") {
      navigator.vibrate(15);
    } else if (type === "medium") {
      navigator.vibrate([15, 30, 15]);
    } else if (type === "heavy") {
      navigator.vibrate(35);
    }
  }
}

let iceCandidateQueue: RTCIceCandidateInit[] = [];
let rustIceCandidateQueue: string[] = [];
let isHostMode: boolean = false; // 標記目前是否為被控端
let rustOfferProcessed: boolean = false; // 標記 Rust 是否已經處理完 Offer
let dataChannelControl: RTCDataChannel | null = null;
let dataChannelUnreliable: RTCDataChannel | null = null;
let dataChannelClipboard: RTCDataChannel | null = null;
let dataChannelFileTransfer: RTCDataChannel | null = null;
let dataChannelSystemControl: RTCDataChannel | null = null;
let availableMonitors: any[] = [];
let currentMonitorIndex: number = 0;
let _clipboardPollInterval: ReturnType<typeof setInterval> | null = null;
let _lastRemoteClipboard = "";
let currentRemoteId: string | null = null;   // 當前連線的遠端 ID（追蹤用）
let myId: string = "";                        // 本機 9 位數 ID
let myPin: string = "";                       // 本機 Access PIN（被呼叫端驗證用）
let currentCursorPercentX = 0.5;               // 全域游標百分比 X（用於避讓對焦）
let currentCursorPercentY = 0.5;               // 全域游標百分比 Y（用於避讓對焦）

// 取得信令伺服器 WebSocket URL（優先環境變數，備用本地，支援 LAN 測試）
// 官方中心化信令伺服器位址 (未來上架部署於雲端的主機)
const OFFICIAL_SIGNALING_SERVER = "wss://twosyn-signaling.onrender.com/ws";

// 取得信令伺服器 WebSocket URL
function getSignalingUrl(): string {
  // 1. 如果有注入環境變數，優先使用
  if ((window as any).__SIGNALING_URL__) {
    return (window as any).__SIGNALING_URL__;
  }
  
  // 2. 在 Tauri 中，無論開發或正式環境，window.location.hostname 通常都是 localhost 或 tauri.localhost
  // 確保 iOS 與 Mac mini 能夠順利連線，直接回傳公開部署的信令伺服器網址
  return OFFICIAL_SIGNALING_SERVER;
}

const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] }
];

let ICE_SERVERS: RTCIceServer[] = [...DEFAULT_STUN_SERVERS];

function loadCustomIceServers() {
  try {
    const customStr = localStorage.getItem("custom_turn_servers");
    if (customStr) {
      const customServers = JSON.parse(customStr);
      if (Array.isArray(customServers) && customServers.length > 0) {
        // 驗證每個伺服器項目必須包含 urls 屬性
        const validServers = customServers.filter(
          (s: any) => s && s.urls && (typeof s.urls === 'string' || Array.isArray(s.urls))
        );
        if (validServers.length > 0) {
          // 始終保留預設 STUN，附加自訂 TURN
          ICE_SERVERS = [...DEFAULT_STUN_SERVERS, ...validServers];
          console.log(`[ICE] Loaded ${validServers.length} custom TURN server(s)`);
        }
      }
    }
  } catch(e) {
    console.error("Failed to parse custom TURN servers, reverting to defaults", e);
    ICE_SERVERS = [...DEFAULT_STUN_SERVERS];
  }
}
loadCustomIceServers();

// 宣告語系翻譯字典快取
let translations: Record<string, string> = {};
let isPinVisible = false;
let isPanelOpen = false;
let isDirectTouchMode = false;
// 游標策略（仿 Chrome 遠端桌面）：改用「本地游標預測」。
// false = 前端即時繪製本地合成游標（零延遲跟手），並由被控端關閉 shows_cursor 避免雙游標。
// 軌跡板模式送的是絕對座標，本地預測游標與被控端游標同步、點擊零漂移。
// 代價：失去 macOS 原生游標外形（I-beam/縮放箭頭），統一顯示箭頭。
// 若連到「仍會烘焙游標」的舊版被控端，改回 true 以免雙游標。
const HOST_RENDERS_CURSOR = false;

// 萬用英文 Fallback 字典，供載入錯誤或翻譯遺漏時調用，徹底與寫死中文解耦
const fallbackTranslations: Record<string, string> = {
  "my_id_loading": "Loading...",
  "hwid_loading": "Loading...",
  "hwid_failed": "Failed to get HWID",
  "status_active": "Activated (Buyout)",
  "status_inactive": "Unauthorized",
  "status_trial": "Trial ({0} days left)",
  "status_expired": "Trial Expired",
  "err_host_expired": "Host trial period has expired. Please enter a valid license key to continue receiving connections.",
  "alert_license_success": "Activation successful! The license ticket is securely stored locally.",
  "alert_license_fail": "Activation failed: invalid key or hardware mismatch.",
  "alert_license_error": "Verification error: ",
  "err_invalid_signature": "The activation ticket signature is invalid.",
  "err_no_ticket": "Server returned no activation ticket.",
  "err_connect_server": "Failed to connect to the activation server: ",
  "err_limit_exceeded": "Activation failed: the activation limit (max 5 devices) has been reached. Currently bound: {0}",
  "err_cooldown_active": "Cooldown active: deactivation is too frequent, please try again in {0} seconds.",
  "err_invalid_license": "Invalid license key.",
  "err_device_not_bound": "Deactivation failed: device is not bound to this key.",
  "err_license_empty": "License key and HWID cannot be empty.",
  "file_enabled": "Enabled",
  "file_disabled": "Disabled (degraded protection)",
  "alert_sdp_success": "Local SDP Offer generated and copied to clipboard successfully.",
  "alert_sdp_fail": "Failed to generate SDP: ",
  "alert_sdp_empty": "Please paste the remote SDP first.",
  "alert_sdp_apply_fail": "Failed to apply SDP: ",
  "alert_sdp_applied": "Successfully applied remote SDP! ICE negotiating...\nDecentralized secure handshake complete! AES-256-GCM data channel established.",
  "diag_status_checking": "Checking...",
  "alert_diag_failed": "Diagnostic failed: ",
  "protocol_p2p": "WebRTC P2P (Direct)",
  "protocol_relay": "Relay (TURN)",
  "encryption_gcu": "AES-256-GCM (GPU Accelerated)",
  "diag_dns_success": "Success (Connected)",
  "diag_dns_failed": "Failed (No Connection)",
  "diag_initial_desc": "Click the button above to run diagnostics on secure storage and network pipes.",
  "copy_tooltip": "Copy",
  "err_macos_permissions_missing": "⚠️ macOS permissions (Screen Recording / Accessibility) are missing!",
  "btn_how_to_fix": "How to Fix",
  "perm_modal_title": "macOS System Permissions Guide",
  "perm_modal_desc": "Due to macOS security policies, 2syn requires \"Screen Recording\" and \"Accessibility\" permissions to stream screens and inject input events. Please follow these steps:",
  "perm_modal_step_1": "Open your Mac's \"System Settings\".",
  "perm_modal_step_2": "Navigate to \"Privacy & Security\".",
  "perm_modal_step_3": "Under \"Screen & System Audio Recording\", enable 2syn.",
  "perm_modal_step_4": "Under \"Accessibility\", enable 2syn.",
  "perm_modal_step_5": "Once completed, please restart 2syn application to apply changes.",
  "btn_reprompt_perm": "Re-request System Permission Prompt",
  "video_error_title": "⚠️ No Video Stream Detected",
  "video_error_desc": "If the remote device is macOS, please ensure \"Screen Recording\" and \"Accessibility\" permissions are granted in System Settings. If blocked by browser autoplay policies, click Force Play below.",
  "btn_force_play": "Force Play",
  "btn_dismiss": "Dismiss",

  // 系統日誌與連線狀態 Fallback 翻譯
  "status_connecting": "Connecting...",
  "status_online": "Online",
  "status_offline": "Offline",
  "log_status_connected": "Connected",
  "log_status_disconnected": "Disconnected",
  "log_status_checking": "Checking",
  "log_status_completed": "Completed",
  "log_status_stable": "Stable",
  "log_status_failed": "Failed",
  "log_status_gathering": "Gathering",
  "log_status_closed": "Closed",
  "log_status_new": "New",
  "log_status_video": "Video",
  "log_status_audio": "Audio",
  "log_webrtc_received_track": "[WebRTC] Received remote track: {0}",
  "log_webrtc_ice_state": "[WebRTC] ICE Connection State: {0}",
  "log_webrtc_conn_state": "[WebRTC] Connection State: {0}",
  "log_webrtc_gather_state": "[WebRTC] ICE Gathering State: {0}",
  "log_webrtc_sig_state": "[WebRTC] Signaling State: {0}",
  "log_webrtc_negotiation": "[WebRTC] Negotiation Needed",
  "log_webrtc_play_failed": "[WebRTC] Video Playback Failed: {0}",
  "log_webrtc_rust_state": "[WebRTC-Rust] State Changed: {0}",
  "log_webrtc_video_error": "[WebRTC-Video] Video capture/encode error: {0}",
  "log_video_encoded_frame": "[Video] Encoded frame size: {0} bytes",
  "log_video_send_failed": "[Video] Failed to send frame: {0}",
  "log_video_send_timeout": "[Video] Frame transmission timed out (network congestion)",
  "log_input_simulate_failed": "[input-control] simulate failed: {0}",
  "log_input_rejected": "[security input-control] packet rejected: {0}",
  "log_input_unreliable_failed": "[input-unreliable] simulate failed: {0}",
  "log_hwid_failed": "Failed to get HWID: {0}",
  "log_sig_manual_reconnect": "User manually triggered signaling reconnection...",
  "log_sig_reconnect_failed": "Reconnection failed: {0}",
  "log_sig_connected_logging_in": "Connected to signaling server, logging in...",
  "log_webrtc_answer_applied": "Remote Answer applied, ICE negotiating...",
  "log_webrtc_apply_answer_failed": "Failed to apply Answer: {0}",
  "log_webrtc_add_ice_failed": "Failed to add ICE Candidate: {0}",
  "log_webrtc_add_ice_queue_failed": "Failed to add ICE Candidate from queue: {0}",
  "log_webrtc_send_ice_rust_failed": "Failed to forward ICE Candidate to Rust: {0}",
  "log_sig_server_error": "Signaling server error: {0}",
  "log_sig_disconnected_retry": "WebSocket disconnected. Retrying in 5 seconds...",
  "log_sig_connection_error": "Signaling connection error: {0}",
  "log_webrtc_rust_handling_offer": "Delegating remote Offer to Rust backend...",
  "log_webrtc_rust_answer_sent": "Rust Answer returned to {0}",
  "log_webrtc_send_ice_rust_queue_failed": "Failed to forward ICE Candidate queue to Rust: {0}",
  "log_webrtc_host_serious_error": "Critical error in handle_remote_offer_as_host: {0}",
  "log_datachannel_control_open": "DataChannel [input-control] opened",
  "log_datachannel_control_close": "DataChannel [input-control] closed",
  "log_control_execute_failed": "Failed to execute remote input: {0}",
  "log_datachannel_unreliable_open": "DataChannel [input-unreliable] opened",
  "log_datachannel_unreliable_close": "DataChannel [input-unreliable] closed",
  "log_unreliable_execute_failed": "Failed to execute remote unreliable input: {0}",
  "log_datachannel_file_open": "DataChannel [file-transfer] opened",
  "log_datachannel_file_close": "DataChannel [file-transfer] closed",
  "log_file_write_failed": "Failed to write file chunk: {0}",
  "log_webrtc_intercept_rust_candidate": "Intercepted Rust ICE candidate, forwarding via WebSocket",
  "log_webrtc_init_call": "Initiating WebRTC connection to {0} (PIN: {1})",
  "log_license_web_skip": "Web Client environment, skipping local license check",
  "log_license_active_restored": "Valid license detected at startup. Activation state restored.",
  "log_license_trial_days": "Trial active, days left: {0}",
  "log_license_expired": "Trial period has expired",
  "log_license_check_failed": "License validation failed at startup: {0}",
  "log_privacy_toggle_failed": "Failed to toggle Privacy Mode: {0}",
  "log_polling_error": "Status polling error: {0}",
  "log_gesture_long_press": "Long press detected. Simulating right click & vibrating",
  "log_gesture_cancelled": "Touch gesture cancelled, resetting states & releasing mouse buttons",
  "log_input_focus_lost": "Focus lost or tab hidden. Resetting key states via ResetState (0xFF)",
  "log_sig_web_focus_reconnect": "Web Client focused and offline, reconnecting signaling...",
  "log_sig_web_focus_ping": "Web Client focused, sending ping to verify connectivity...",
  "log_sig_web_visible_reconnect": "Web Client visible and offline, reconnecting signaling...",
  "log_sig_tauri_rust_delegation": "Tauri desktop environment detected, initializing Rust signaling worker...",
  "log_sig_rust_connecting": "[Rust] Connecting to signaling server...",
  "log_sig_rust_connected": "[Rust] Connected and logged in to signaling server.",
  "log_sig_rust_disconnected": "[Rust] Connection lost, preparing to reconnect...",
  "log_sig_rust_start_success": "Rust signaling client successfully initialized.",
  "log_sig_rust_start_failed": "Failed to start Rust signaling: {0}",
  "log_sig_rust_offer_received": "[Rust] Received offer from {0}, verifying...",
  "log_sig_rust_offer_success": "[Rust] Offer verified, Answer sent to {0}",
  "log_sig_rust_offer_rejected": "[Rust] Rejected offer from {0}: {1}",
  "log_sig_rust_ice_received": "[Rust] Received ICE Candidate from {0}, applying...",

  // 頁面靜態文字
  "connect_title": "Establish Connection",
  "remote_id_placeholder": "Enter 9-digit Device ID",
  "access_pin_placeholder": "Enter access PIN",
  "btn_connect": "Connect",
  "host_info_title": "Host Information",
  "remote_id": "Remote Device ID",
  "access_pin_label": "Access PIN",
  "access_pin_help": "Enter the 6-digit access PIN displayed on the remote device.",
  "my_pin_label": "Access PIN:",
  "my_id": "My ID:",
  "hwid": "My HWID:",
  "license": "Buyout License Key",
  "privacy_title": "Security & Privacy",
  "privacy_mode": "Privacy Shield Mode (Virtual GPU)",
  "monitor_title": "Network & Video Quality Metrics",
  "metric_fps": "Target Frame Rate",
  "metric_color": "Color Sampling",
  "metric_bitrate": "Max Bitrate Limit",
  "metric_file": "File Transfer",
  "sim_title": "Network Connection Mode",
  "sim_desc": "Adjust network parameters to verify the dynamic degradation of the quality decision tree.",
  "sim_rtt": "RTT Latency",
  "sim_loss": "Packet Loss Rate",
  "sim_relay": "Force Relay Connection",
  "diag_title": "Security & Connectivity Diagnostics",
  "diag_btn": "Run Diagnostics",
  "diag_dns": "STUN Server Lookup:",
  "diag_nat": "NAT Detection Type:",
  "diag_suggest": "Optimization Suggestions",
  "offline_mode": "Offline Connection (SDP)",
  "offline_btn_gen": "Generate & Copy Local SDP Offer",
  "offline_local_placeholder": "Local SDP will be generated here",
  "offline_remote_label": "Enter Remote SDP Answer/Offer",
  "offline_remote_placeholder": "Paste Remote SDP here",
  "offline_btn_apply": "Establish Connection",
  "license_btn_verify": "Verify",
  "license_placeholder": "Enter license key",
  "smart_auto": "Smart Quality Auto-Optimization",
  "smart_auto_active_desc": "System automatically adjusting. Network and stream quality are in optimal states.",
  "sim_advanced_header": "Advanced Developer Tools",
  "metric_loss": "Packet Loss Rate",
  "metric_protocol": "Connection Protocol",
  "metric_encryption": "Codec & Cipher Security",
  "metric_actual_fps": "Actual FPS (Live)",
  "metric_actual_bitrate": "Actual Bitrate (Live)",
  "metric_quality_score": "Connection Quality",
  "quality_excellent": "Excellent",
  "quality_fair": "Fair",
  "quality_poor": "Poor",
  // 地址簿
  "device_book_title": "Saved Devices",
  "device_book_empty": "No saved devices yet. Connect to a device to save it.",
  "device_book_add": "Save Current",
  "device_book_connect": "Connect",
  "device_book_delete": "Remove",
  "device_book_name_placeholder": "Device nickname",
  "device_book_last_connected": "Last connected:",
  "device_book_never": "Never",

  // 新增UI文字翻譯
  "toast_system_error": "⚠️ System Error: Open Advanced Panel to view logs",
  "toggle_panel_title": "Toggle Advanced Panel",
  "tools_title": "Advanced Tools",
  "file_transfer_title": "File Transfer",
  "drop_zone": "Drag & Drop files here or Click to upload",
  "btn_cancel_transfer": "Cancel Transfer",
  "log_title": "System Logs",
  "err_rtc_failed": "P2P connection failed. The local and remote devices might be behind a strict symmetric NAT or firewall and cannot punch through. Please click \"🚀 Enable Relay Mode\" to establish connection.",
  "err_target_offline": "The remote device is offline. Please make sure the device ID is correct.",
  "err_rejected": "Connection rejected: PIN verification failed or remote host denied access.",
  "err_signaling_offline": "Failed to connect to the signaling server. Please check your internet connection.",
  "err_invalid_remote_id": "Please enter a valid 9-digit Device ID.",
  "err_invalid_pin": "Please enter the target access PIN.",
  "pointer_lock_tooltip": "Pointer locked. Press ESC to exit.",
  "btn_fix_network": "🚀 Enable Relay Mode",
  "alert_input_static_password": "Please enter the static password!",
  "toast_static_password_success": "Static password set successfully!",
  "alert_set_static_password_fail": "Failed to set static password: ",
  "alert_connect_failed": "Failed to establish connection: ",
  "alert_handle_remote_offer_failed": "Error handling remote connection request: ",
  "conn_connecting": "Connecting...",
  "conn_connected": "Connected (P2P)",
  "conn_disconnected": "Disconnected",
  "conn_failed": "Connection Failed",
  "conn_closed": "Closed",
  "txt_tailscale_alert": "Due to restricted network conditions (no public IP or strict NAT), it is highly recommended to install Tailscale on both machines. Under Tailscale, you can establish direct high-speed P2P connections bypass most firewalls! Once installed, this light will automatically turn green.",
  "desc_tailscale_detected": "Tailscale interface detected. You now have 100% traversal rate through cellular and CGNAT networks for ultra-stable, high-speed connections.",
  "desc_ipv6_detected": "IPv6 network detected, allowing successful direct P2P connection in most cases. However, strict IPv4-only mobile connections may fall back to relay. Tailscale is recommended for the best experience.",
  "desc_nat_warning": "Your network lacks IPv6 and is behind multiple NAT layers. The probability of building a direct P2P connection is very low, which may lead to high latency. We highly recommend installing Tailscale.",
  "alert_answer_generated": "Answer SDP has been generated and copied to your clipboard. Please send it to the remote party.",
  "alert_web_diag_unsupported": "Connectivity diagnostics are not supported in Web Client mode.",
  "btn_scale_to_fit": "Scale to Fit",
  "btn_original_size": "Original Size",
  "btn_aspect_fill": "Aspect Fill",
  "desc_web_client_info": "Web Client controller. The connection pipeline will be automatically evaluated. If P2P fails due to symmetric NAT or strict firewalls, please click \"🚀 Enable Relay Mode\".",
  "log_title_system_logs": "System Logs",
  "log_status_connecting": "Connecting",
  "btn_diagnose_host": "Diagnose Host",
  "remote_logs_title": "Remote Host Diagnostic Logs",
  "remote_logs_help": "These are the real-time debug logs from the controlled host. If you see \"Screen capture failed\", it means the Mac host has Screen Recording permission checked but still rejected by OS. Please uncheck and recheck the permission, then restart the App.",
  "loading_remote_logs": "Loading remote logs...",
  "ts_guide_title": "Tailscale Zero-Configuration Guide",
  "ts_guide_desc": "Due to ISP Symmetric NAT and firewall limitations on WebRTC, it is highly recommended to install Tailscale, a free and secure virtual private network tool, on both devices to ensure a 100% P2P ultra-low latency connection.",
  "ts_step_1_title": "Step 1: Download & Install",
  "ts_step_1_desc": "Download and install Tailscale on both your controlled host and controller devices.",
  "ts_download_mac": "Download for Mac / Windows",
  "ts_download_ios": "Download for iOS (App Store)",
  "ts_download_android": "Download for Android",
  "ts_step_2_title": "Step 2: Log In & Register",
  "ts_step_2_desc": "Launch Tailscale. Both devices must log in to the same account (e.g., the same Google account) so they automatically join the same secure virtual private network.",
  "ts_step_3_title": "Step 3: Enable VPN Connection",
  "ts_step_3_desc": "Toggle the switch to 'Connected' in the mobile App (accept VPN configuration prompts if requested). Confirm that the Tailscale menu bar icon on your Mac displays 'Connected'.",
  "ts_step_4_desc": "💡 Once completed, the connection indicator on the Mac host will automatically turn green, allowing your controller device to establish a direct connection without failed or black screen issues.",
  "btn_show": "Show",
  "btn_hide": "Hide",

  // 首次執行提示 Modal
  "first_run_title": "Welcome to 2syn — Set Your Security Key",
  "first_run_subtitle": "First Launch — Required Setup",
  "first_run_body": "Before accepting any remote connection, you must set a Static Access Password. This password is the sole authentication key for all incoming remote sessions. Without it, all connection requests will be automatically rejected.",
  "first_run_tip": "Use a strong password of at least 8 characters, combining uppercase letters, lowercase letters, and numbers to keep your device secure.",
  "first_run_btn_go": "Go to Set Static Password",
  "first_run_btn_skip": "Set Later (Connections Will Be Rejected)",

  "ui_network_traversal": "NETWORK TRAVERSAL",
  "ui_network_traversal_desc1": "Tailscale interface detected. You now have 100% traversal rate through cellular and CGNAT networks for ultra-stable, high-speed connections.",
  "ui_network_traversal_desc2": "If a TURN server is unavailable, it is recommended to install the free VPN tool Tailscale on both devices to achieve 100% P2P ultra-low latency direct connection.",
  "ui_run_on_startup": "Run on System Startup",
  "ui_run_diagnostics": "Run Diagnostics",
  "ui_network_metrics": "Network & Video Quality Metrics",
  "ui_host_info": "Host Information",
  "ui_security_privacy": "Security & Privacy",
  "ui_system_logs": "System Logs",
  "ui_advanced_dev": "Advanced Developer Tools",
  "ui_diagnostics": "Security & Connectivity Diagnostics",
  "ui_my_id": "My ID:",
  "ui_my_mac": "My MAC:",
  "ui_my_hwid": "My HWID:",
  "ui_signaling_status": "Signaling Status:",
  "ui_static_password": "Static Access Password:",
  "ui_stun_lookup": "STUN Server Lookup:",
  "ui_nat_type": "NAT Detection Type:",
  "ui_opt_suggestions": "Optimization Suggestions",
  "ui_click_analyze": "Click the button above to analyze your device secure store and connection pipes.",
  "ui_conn_protocol": "Connection Protocol",
  "ui_codec_sec": "Codec & Cipher Security",
  "ui_actual_fps": "Actual FPS (Live)",
  "ui_actual_bitrate": "Actual Bitrate (Live)",
  "ui_net_lat": "Network Latency (RTT)",
  "ui_pkt_loss": "Packet Loss Rate",
  "ui_sim_rtt": "Simulated RTT Latency",
  "ui_sim_loss": "Simulated Packet Loss",
  "ui_tgt_fps": "Target Frame Rate",
  "ui_max_bit": "Max Bitrate Limit",
  "ui_color_samp": "Color Sampling",
  "ui_priv_shield": "Privacy Shield Mode (Virtual GPU)",
  "ui_smart_opt": "Smart Quality Auto-Optimization",
  "ui_offline_sdp": "Offline Connection (SDP)",
  "ui_enter_sdp": "Enter Remote SDP Answer/Offer",
  "ui_gen_sdp": "Generate & Copy Local SDP Offer",
  "ui_force_play": "Force Play",
  "ui_import_json": "Import JSON",
  "ui_export_json": "Export JSON",
  "ui_save_reload": "Save and Reload",
  "ui_byoi": "Advanced: Bring Your Own TURN (BYOI)",
  "ui_byoi_desc": "If you host a custom TURN relay server (e.g., Coturn), you can enter the JSON array configuration here:",
  "ui_dl_mac": "Download for Mac / Windows",
  "ui_dl_ios": "Download for iOS (App Store)",
  "ui_dl_android": "Download for Android",
  "ui_logs_hint": "Above are the real-time debug logs for the host device. If you see 'Screen capture failed', it means the Mac host has checked the permission but is still rejected by the system. Please try unchecking and checking the App permission again and restart the App.",
  "ui_btn_reprompt": "Re-prompt System Permission",
  "ui_permission_warning": "Insufficient macOS system permissions will cause a black screen during remote control!",
  "ui_dl_hint": "Both host and client devices need to download and install the application.",
  "ui_sys_auto_adj": "System automatically adjusting. Network and stream quality are in optimal states.",
  "ui_sim_relay_mode": "Simulate Relay Mode",
  "ui_btn_disconnect": "Disconnect",
  "ui_confirm_disconnect": "Are you sure you want to disconnect?",
};

// 統一翻譯取值函數
function t(key: string): string {
  return translations[key] || fallbackTranslations[key] || key;
}
(window as any).t = t;

// 全域說明與隱私政策 Tab 狀態與切換函數
let activeHelpTab: "controls" | "privacy" = "controls";

function switchHelpTab(tab: "controls" | "privacy") {
  activeHelpTab = tab;
  
  const btnControls = document.getElementById("tab-btn-controls");
  const btnPrivacy = document.getElementById("tab-btn-privacy");
  
  if (btnControls) btnControls.classList.toggle("active", tab === "controls");
  if (btnPrivacy) btnPrivacy.classList.toggle("active", tab === "privacy");
  
  const langSelect = document.getElementById("language-select") as HTMLSelectElement;
  const currentLang = langSelect ? langSelect.value : "zh-TW";
  const doc = I18N_HELP_DOCS[currentLang] || I18N_HELP_DOCS["en"];
  
  const contentArea = document.getElementById("help-modal-content");
  if (contentArea) {
    contentArea.innerHTML = tab === "controls" ? doc.controlsHtml : doc.privacyHtml;
  }
}
(window as any).switchHelpTab = switchHelpTab;

let lastDiagnosticResult: {
  license_active: boolean;
  stun_dns_resolved: boolean;
  nat_type: string;
  suggested_action: string;
} | null = null;

function showDiagnosticResult() {
  if (!lastDiagnosticResult) return;
  const dnsVal = document.getElementById("val-diag-dns");
  const natVal = document.getElementById("val-diag-nat");
  const suggestVal = document.getElementById("val-diag-suggest");
  
  if (dnsVal) {
    dnsVal.textContent = lastDiagnosticResult.stun_dns_resolved 
      ? t("diag_dns_success")
      : t("diag_dns_failed");
    dnsVal.style.color = lastDiagnosticResult.stun_dns_resolved ? "var(--color-success)" : "var(--color-danger)";
  }
  
  if (natVal) {
    natVal.textContent = t(lastDiagnosticResult.nat_type);
    natVal.style.color = lastDiagnosticResult.license_active ? "var(--color-success)" : "var(--color-danger)";
  }
  
  if (suggestVal) {
    suggestVal.textContent = t(lastDiagnosticResult.suggested_action);
  }
}

// 初始化多國語言切換器
async function initI18n() {
  const langSelect = document.getElementById("language-select") as HTMLSelectElement;
  
  // 監聽選擇變更
  langSelect.addEventListener("change", async (e) => {
    const target = e.target as HTMLSelectElement;
    await loadLanguage(target.value);
  });

  // 預設偵測系統語系或採用繁體中文
  const systemLang = navigator.language;
  let defaultLang = "zh-TW";
  
  if (systemLang.startsWith("zh-CN")) {
    defaultLang = "zh-CN";
  } else if (systemLang.startsWith("ja")) {
    defaultLang = "ja";
  } else if (systemLang.startsWith("ko")) {
    defaultLang = "ko";
  } else if (systemLang.startsWith("de")) {
    defaultLang = "de";
  } else if (systemLang.startsWith("th")) {
    defaultLang = "th";
  } else if (systemLang.startsWith("id")) {
    defaultLang = "id";
  } else if (systemLang.startsWith("ms")) {
    defaultLang = "ms";
  } else if (systemLang.startsWith("ru")) {
    defaultLang = "ru";
  } else if (systemLang.startsWith("es")) {
    defaultLang = "es";
  } else if (systemLang.startsWith("en") || !systemLang.startsWith("zh")) {
    defaultLang = "en";
  }

  langSelect.value = defaultLang;
  await loadLanguage(defaultLang);
}

// 載入指定的語言 JSON 檔案並更新 DOM
async function loadLanguage(lang: string) {
  try {
    const response = await fetch(`./locales/${lang}.json`);
    translations = await response.json();
    updateDomTranslations();
  } catch (error) {
    console.error(t("log_lang_load_failed"), lang, error);
  }
}

// 更新 DOM 的文字內容
function updateDomTranslations() {
  // 更新所有對應的 DOM 元素
  setTextContent("txt-connect-title", t("connect_title"));
  setPlaceholder("remote-id-input", t("remote_id_placeholder"));
  setPlaceholder("access-pin-input", t("access_pin_placeholder"));

  setTextContent("txt-network-traversal-title", t("ui_network_traversal"));
  setTextContent("txt-network-health-title-2", t("ui_network_traversal"));
  setTextContent("txt-network-traversal-desc-1", t("ui_network_traversal_desc1"));
  setTextContent("txt-network-traversal-desc-2", t("ui_network_traversal_desc2"));
  setTextContent("txt-run-on-startup", t("ui_run_on_startup"));
  setTextContent("txt-run-diagnostics-btn", t("ui_run_diagnostics"));
  setTextContent("txt-network-metrics-title", t("ui_network_metrics"));
  setTextContent("txt-host-info-title-main", t("ui_host_info"));
  setTextContent("txt-security-privacy-title", t("ui_security_privacy"));
  setTextContent("txt-system-logs-title-main", t("ui_system_logs"));
  setTextContent("txt-advanced-dev-title", t("ui_advanced_dev"));
  setTextContent("txt-diag-title-main", t("ui_diagnostics"));
  setTextContent("txt-my-id-label", t("ui_my_id"));
  setTextContent("txt-my-mac-label", t("ui_my_mac"));
  setTextContent("txt-my-hwid-label", t("ui_my_hwid"));
  setTextContent("txt-signaling-status-label", t("ui_signaling_status"));
  setTextContent("txt-unattended-access-label", t("ui_static_password"));
  setTextContent("txt-stun-lookup-label", t("ui_stun_lookup"));
  setTextContent("txt-nat-type-label", t("ui_nat_type"));
  setTextContent("txt-opt-sug-label", t("ui_opt_suggestions"));
  setTextContent("txt-click-analyze-label", t("ui_click_analyze"));
  setTextContent("txt-conn-protocol-label", t("ui_conn_protocol"));
  setTextContent("txt-codec-sec-label", t("ui_codec_sec"));
  setTextContent("txt-actual-fps-label", t("ui_actual_fps"));
  setTextContent("txt-actual-bitrate-label", t("ui_actual_bitrate"));
  setTextContent("txt-net-lat-label", t("ui_net_lat"));
  setTextContent("txt-pkt-loss-label", t("ui_pkt_loss"));
  setTextContent("txt-sim-rtt-label", t("ui_sim_rtt"));
  setTextContent("txt-sim-loss-label", t("ui_sim_loss"));
  setTextContent("txt-tgt-fps-label", t("ui_tgt_fps"));
  setTextContent("txt-max-bit-label", t("ui_max_bit"));
  setTextContent("txt-color-samp-label", t("ui_color_samp"));
  setTextContent("txt-priv-shield-label", t("ui_priv_shield"));
  setTextContent("txt-smart-opt-label", t("ui_smart_opt"));
  setTextContent("txt-offline-sdp-title", t("ui_offline_sdp"));
  setTextContent("txt-enter-sdp-label", t("ui_enter_sdp"));
  setTextContent("txt-gen-sdp-btn", t("ui_gen_sdp"));
  setTextContent("txt-force-play-btn", t("ui_force_play"));
  setTextContent("txt-import-json-btn", t("ui_import_json"));
  setTextContent("txt-export-json-btn", t("ui_export_json"));
  setTextContent("txt-save-reload-btn", t("ui_save_reload"));
  setTextContent("txt-byoi-title", t("ui_byoi"));
  setTextContent("txt-byoi-desc", t("ui_byoi_desc"));
  setTextContent("txt-dl-mac", t("ui_dl_mac"));
  setTextContent("txt-dl-ios", t("ui_dl_ios"));
  setTextContent("txt-dl-android", t("ui_dl_android"));
  setTextContent("txt-logs-hint", t("ui_logs_hint"));
  setTextContent("txt-btn-reprompt", t("ui_btn_reprompt"));
  setTextContent("txt-permission-warning", t("ui_permission_warning"));
  setTextContent("txt-dl-hint", t("ui_dl_hint"));
  setTextContent("txt-sys-auto-adj", t("ui_sys_auto_adj"));
  setTextContent("txt-sim-relay-mode", t("ui_sim_relay_mode"));

  setTextContent("txt-btn-connect", t("btn_connect"));
  setTextContent("txt-host-info-title", t("host_info_title"));
  setTextContent("lbl-remote-id", t("remote_id"));
  setTextContent("lbl-access-pin", t("access_pin_label"));
  setTextContent("lbl-my-pin", t("my_pin_label"));
  setTextContent("lbl-signaling-status", t("lbl_signaling_status"));
  setTextContent("lbl-my-id", t("my_id"));
  setTextContent("lbl-hwid", t("hwid"));
  setTextContent("lbl-static-pwd", t("host.unattended_access"));
  setPlaceholder("input-static-pwd", t("host.pwd_placeholder"));
  setTextContent("btn-toggle-static-pwd", t("host.pwd_show"));
  setTextContent("btn-set-static-pwd", t("host.pwd_save"));
  setTextContent("btn-delete-static-pwd", t("device_book_delete"));
  setTextContent("lbl-license", t("license"));
  setTextContent("txt-privacy-title", t("privacy_title"));
  setTextContent("lbl-privacy-mode", t("privacy_mode"));
  setTextContent("txt-monitor-title", t("monitor_title"));
  
  setTextContent("lbl-metric-fps", t("metric_fps"));
  setTextContent("lbl-metric-color", t("metric_color"));
  setTextContent("lbl-metric-bitrate", t("metric_bitrate"));
  setTextContent("lbl-metric-file", t("metric_file"));
  
  setTextContent("txt-sim-title", t("sim_title"));
  setTextContent("txt-sim-desc", t("sim_desc"));
  setTextContent("lbl-sim-rtt", t("sim_rtt"));
  setTextContent("lbl-sim-loss", t("sim_loss"));
  setTextContent("lbl-sim-relay", t("sim_relay"));

  const langSelect = document.getElementById("language-select") as HTMLSelectElement;
  const currentLang = langSelect ? langSelect.value : "zh-TW";
  const doc = I18N_HELP_DOCS[currentLang] || I18N_HELP_DOCS["en"];
  
  setTextContent("txt-help-title", t("help_title"));
  setTextContent("tab-btn-controls", doc.tabControls);
  setTextContent("tab-btn-privacy", doc.tabPrivacy);
  
  const contentArea = document.getElementById("help-modal-content");
  if (contentArea) {
    contentArea.innerHTML = activeHelpTab === "controls" ? doc.controlsHtml : doc.privacyHtml;
  }

  // 新增右側面板的翻譯綁定
  setTextContent("txt-tools-title", t("tools_title"));
  setTextContent("txt-log-title", t("log_title"));
  
  const btnTogglePanel = document.getElementById("btn-toggle-panel");
  if (btnTogglePanel) {
    btnTogglePanel.title = t("toggle_panel_title");
  }

  // 自我診斷與手動連線相關元件語系支援
  setTextContent("txt-diag-title", t("diag_title"));
  setTextContent("btn-run-diagnostic", t("diag_btn"));
  setTextContent("lbl-diag-dns", t("diag_dns"));
  setTextContent("lbl-diag-nat", t("diag_nat"));
  setTextContent("lbl-diag-suggest", t("diag_suggest"));
  
  if (lastDiagnosticResult) {
    showDiagnosticResult();
  } else {
    const suggestVal = document.getElementById("val-diag-suggest");
    if (suggestVal) {
      suggestVal.textContent = t("diag_initial_desc");
    }
  }

  setTextContent("lbl-offline-mode", t("offline_mode"));
  setTextContent("btn-gen-local-sdp", t("offline_btn_gen"));
  setPlaceholder("txt-local-sdp", t("offline_local_placeholder"));
  setTextContent("lbl-remote-sdp", t("offline_remote_label"));
  setPlaceholder("txt-remote-sdp", t("offline_remote_placeholder"));
  setTextContent("btn-apply-remote-sdp", t("offline_btn_apply"));

  // 智慧自動、效能卡片與說明區塊之對應翻譯
  setTextContent("lbl-smart-auto", t("smart_auto"));
  setTextContent("txt-auto-active", t("smart_auto_active_desc"));
  setTextContent("txt-sim-header", t("sim_advanced_header"));
  setTextContent("lbl-metric-rtt", t("metric_rtt"));
  setTextContent("lbl-metric-loss", t("metric_loss"));
  setTextContent("lbl-metric-protocol", t("metric_protocol"));
  setTextContent("lbl-metric-encryption", t("metric_encryption"));
  setTextContent("lbl-metric-actual-fps", t("metric_actual_fps"));
  setTextContent("lbl-metric-actual-bitrate", t("metric_actual_bitrate"));
  setTextContent("lbl-metric-quality-score", t("metric_quality_score"));
  setTextContent("txt-device-book-title", t("device_book_title"));

  // 說明區塊文字更新
  setTextContent("help-remote-id", t("help_remote_id"));
  setTextContent("help-access-pin", t("access_pin_help"));
  setTextContent("help-offline-sdp", t("help_offline_sdp"));
  setTextContent("help-license", t("help_license"));
  setTextContent("help-privacy", t("help_privacy"));
  setTextContent("help-sim", t("help_sim"));
  setTextContent("help-sim-rtt", t("help_sim_rtt"));
  setTextContent("help-sim-loss", t("help_sim_loss"));
  setTextContent("help-sim-relay", t("help_sim_relay"));
  setTextContent("help-smart-auto", t("help_smart_auto"));
  
  // 更新一鍵複製按鈕之 Tooltip 翻譯
  const btnCopyId = document.getElementById("btn-copy-id");
  if (btnCopyId) btnCopyId.setAttribute("title", t("copy_tooltip"));
  const btnCopyHwid = document.getElementById("btn-copy-hwid");
  if (btnCopyHwid) btnCopyHwid.setAttribute("title", t("copy_tooltip"));

  // 更新授權狀態徽章文字
  const badge = document.getElementById("license-status");
  if (badge) {
    if (badge.classList.contains("status-active")) {
      badge.textContent = t("status_active");
    } else {
      badge.textContent = t("status_inactive");
    }
  }
  
  // 新增：Pointer Lock Tooltip 與穿透模式按鈕
  setTextContent("pointer-lock-tooltip", t("pointer_lock_tooltip"));
  setTextContent("btn-fix-network", t("btn_fix_network"));

  // macOS 權限橫幅與 Modal 翻譯
  setTextContent("txt-permission-warning", t("err_macos_permissions_missing"));
  setTextContent("btn-fix-permissions", t("btn_how_to_fix"));
  setTextContent("txt-perm-modal-title", t("perm_modal_title"));
  setTextContent("txt-perm-modal-desc", t("perm_modal_desc"));
  setTextContent("txt-perm-modal-step-1", t("perm_modal_step_1"));
  setTextContent("txt-perm-modal-step-2", t("perm_modal_step_2"));
  setTextContent("txt-perm-modal-step-3", t("perm_modal_step_3"));
  setTextContent("txt-perm-modal-step-4", t("perm_modal_step_4"));
  setTextContent("txt-perm-modal-step-5", t("perm_modal_step_5"));
  setTextContent("btn-perm-modal-trigger", t("btn_reprompt_perm"));

  // 視訊黑屏錯誤 Overlay 翻譯
  setTextContent("txt-video-error-title", t("video_error_title"));
  setTextContent("txt-video-error-desc", t("video_error_desc"));
  setTextContent("btn-video-retry-play", t("btn_force_play"));
  setTextContent("btn-video-error-close", t("btn_dismiss"));

  // 系統日誌標題翻譯
  setTextContent("txt-system-logs-title", t("log_title_system_logs"));

  // 遠端主機診斷與日誌翻譯更新
  setTextContent("btn-video-diagnose", t("btn_diagnose_host"));
  setTextContent("txt-remote-logs-title", t("remote_logs_title"));
  setTextContent("txt-remote-logs-help", t("remote_logs_help"));

  // Tailscale 零基礎穿透說明書 DOM 翻譯更新
  setTextContent("txt-ts-guide-title", t("ts_guide_title"));
  setTextContent("txt-ts-guide-desc", t("ts_guide_desc"));
  setTextContent("txt-ts-step-1-title", t("ts_step_1_title"));
  setTextContent("txt-ts-step-1-desc", t("ts_step_1_desc"));
  setTextContent("lnk-ts-download-mac", t("ts_download_mac"));
  setTextContent("lnk-ts-download-ios", t("ts_download_ios"));
  setTextContent("lnk-ts-download-android", t("ts_download_android"));
  setTextContent("txt-ts-step-2-title", t("ts_step_2_title"));
  setTextContent("txt-ts-step-2-desc", t("ts_step_2_desc"));
  setTextContent("txt-ts-step-3-title", t("ts_step_3_title"));
  setTextContent("txt-ts-step-3-desc", t("ts_step_3_desc"));
  setTextContent("txt-ts-step-4-desc", t("ts_step_4_desc"));

  // 切換 PIN 顯示按鈕翻譯更新
  const btnTogglePin = document.getElementById("btn-toggle-pin");
  if (btnTogglePin) {
    btnTogglePin.textContent = isPinVisible ? t("btn_hide") : t("btn_show");
  }

  // 1. 連線狀態徽章（Signaling Status）徽章即時重新翻譯
  const statusEl = document.getElementById("val-signaling-status");
  if (statusEl) {
    if (statusEl.classList.contains("status-active")) {
      statusEl.textContent = t("status_online") || "Online";
    } else if (statusEl.classList.contains("status-trial")) {
      statusEl.textContent = t("status_connecting") || "Connecting...";
    } else {
      statusEl.textContent = t("status_offline") || "Offline";
    }
  }

  // 2. 歷史日誌動態重譯與重繪
  const overlay = document.getElementById('debug-overlay');
  if (overlay) {
    Array.from(overlay.children).forEach((child) => {
      const line = child as HTMLDivElement;
      const originalMsg = line.dataset.originalMsg;
      const timestamp = line.dataset.timestamp;
      const color = line.dataset.color;
      if (originalMsg && timestamp) {
        let msg = originalMsg;
        try {
          msg = translateLogMessage(originalMsg, t);
        } catch (err) {
          // 忽略錯誤
        }
        line.textContent = `[${timestamp}] ${msg}`;
        if (color) line.style.color = color;
      }
    });
  }

  // 首次執行提示 Modal 翻譯
  setTextContent("txt-first-run-title", t("first_run_title"));
  setTextContent("txt-first-run-subtitle", t("first_run_subtitle"));
  setTextContent("txt-first-run-body", t("first_run_body"));
  setTextContent("txt-first-run-tip", t("first_run_tip"));
  setTextContent("txt-first-run-btn-go", t("first_run_btn_go"));
  setTextContent("txt-first-run-btn-skip", t("first_run_btn_skip"));

  // 自動化 data-i18n 與 data-i18n-placeholder 翻譯解析
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "button" && (el as HTMLInputElement).type !== "submit") {
         (el as HTMLInputElement).placeholder = t(key);
      } else {
         el.textContent = t(key);
      }
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) {
      (el as HTMLInputElement | HTMLTextAreaElement).placeholder = t(key);
    }
  });

  const btnDisconnect = document.getElementById("btn-disconnect");
  if (btnDisconnect) {
    btnDisconnect.textContent = "🔌 " + t("ui_btn_disconnect");
  }
}

function setTextContent(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setPlaceholder(id: string, text: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (el) el.placeholder = text;
}

// =========================================================================
// 核心 Tauri 後端互動邏輯
// =========================================================================

// 獲取硬體特徵碼 (HWID)
async function fetchHwid() {
  if (!isDesktopTauri()) {
    setTextContent("val-hwid", t("hwid_failed"));
    return;
  }
  try {
    const hwid = await invoke<string>("get_device_hwid");
    const valHwid = document.getElementById("val-hwid");
    if (valHwid) {
      valHwid.textContent = hwid;
      valHwid.title = hwid; // 懸停顯示完整 HWID
    }
  } catch (error) {
    console.error("獲取 HWID 失敗:", error);
    setTextContent("val-hwid", t("hwid_failed"));
  }
}

// 產生模擬的 9 位數本機 ID (去中心化定址)
// 使用 sessionStorage 確保同一次啟動 ID 固定不變
function generateMockMyId(): string {
  const valMyId = document.getElementById("val-my-id");
  const r = () => Math.floor(100 + Math.random() * 900);
  
  // 從 localStorage 取回已產生的 ID，確保重開程式後 ID 永久一致
  let storedId = localStorage.getItem("2syn_my_id");
  if (!storedId) {
    storedId = `${r()}${r()}${r()}`;
    localStorage.setItem("2syn_my_id", storedId);
  }
  
  if (valMyId) {
    valMyId.textContent = `${storedId.slice(0,3)}-${storedId.slice(3,6)}-${storedId.slice(6)}`;
  }
  return storedId; // 回傳純數字字串（不含 dash），供信令登入使用
}

async function loadMyMac() {
  const valMyMac = document.getElementById("val-my-mac");
  if (!valMyMac) return;
  try {
    const mac = await invoke<string>("get_local_mac_address");
    valMyMac.textContent = mac;
  } catch (e) {
    valMyMac.textContent = "N/A";
    console.error("Failed to load MAC:", e);
  }
}

// 初始化開機自動啟動邏輯
async function initAutostart() {
  const chkAutostart = document.getElementById("chk-autostart") as HTMLInputElement;
  if (!chkAutostart || !isDesktopTauri()) return;
  
  try {
    const { isEnabled, enable, disable } = await import("@tauri-apps/plugin-autostart");
    const state = await isEnabled();
    chkAutostart.checked = state;

    chkAutostart.addEventListener("change", async () => {
      try {
        if (chkAutostart.checked) {
          await enable();
          console.log("[autostart] Enabled on boot");
        } else {
          await disable();
          console.log("[autostart] Disabled on boot");
        }
      } catch (error) {
        console.error("切換開機啟動失敗:", error);
        chkAutostart.checked = !chkAutostart.checked;
      }
    });
  } catch (e) {
    console.warn("無法載入或取得 autostart 狀態", e);
  }
}

// 初始化信令手動重連按鈕邏輯
function initSignalingReconnect() {
  const btnReconnect = document.getElementById("btn-reconnect-signaling");
  if (btnReconnect) {
    btnReconnect.addEventListener("click", () => {
      console.log(t("log_sig_manual_reconnect"));
      btnReconnect.textContent = "✓";
      invoke("start_rust_signaling", { myId: myId, pin: "" })
        .then(() => {
          setTimeout(() => { btnReconnect.textContent = "🔄"; }, 1000);
        })
        .catch((err) => {
          console.error(t("log_sig_reconnect_failed"), err);
          btnReconnect.textContent = "❌";
          setTimeout(() => { btnReconnect.textContent = "🔄"; }, 1500);
        });
    });
  }
}

// 初始化固定密碼設定邏輯
async function initStaticPassword() {
  if (!isDesktopTauri()) return;
  const btnSetPwd = document.getElementById("btn-set-static-pwd") as HTMLButtonElement;
  const btnDeletePwd = document.getElementById("btn-delete-static-pwd") as HTMLButtonElement;
  const btnTogglePwd = document.getElementById("btn-toggle-static-pwd") as HTMLButtonElement;
  const inputPwd = document.getElementById("input-static-pwd") as HTMLInputElement;
  const statusBadge = document.getElementById("static-pwd-status-badge");

  // 更新密碼狀態與 UI 展示
  const updateStaticPasswordStatus = async () => {
    try {
      const hasPwd = await invoke<boolean>("check_has_static_password");
      if (statusBadge) {
        if (hasPwd) {
          statusBadge.textContent = "Configured (Secure)";
          statusBadge.className = "status-badge status-active";
          if (btnDeletePwd) btnDeletePwd.style.display = "block";
        } else {
          statusBadge.textContent = "Not Set";
          statusBadge.className = "status-badge status-inactive";
          if (btnDeletePwd) btnDeletePwd.style.display = "none";
        }
      }
    } catch (e) {
      console.warn("檢查固定密碼狀態失敗:", e);
    }
  };

  // 初始化時更新一次狀態
  await updateStaticPasswordStatus();

  // 明碼/隱碼切換按鈕事件
  if (btnTogglePwd && inputPwd) {
    btnTogglePwd.addEventListener("click", () => {
      if (inputPwd.type === "password") {
        inputPwd.type = "text";
        btnTogglePwd.textContent = "Hide";
      } else {
        inputPwd.type = "password";
        btnTogglePwd.textContent = "Show";
      }
    });
  }

  const btnTogglePwdEdit = document.getElementById("btn-toggle-pwd-edit");
  const pwdInputGroup = document.getElementById("static-pwd-input-group");
  if (btnTogglePwdEdit && pwdInputGroup) {
    btnTogglePwdEdit.addEventListener("click", () => {
      if (pwdInputGroup.style.display === "none" || pwdInputGroup.style.display === "") {
        pwdInputGroup.style.display = "flex";
        btnTogglePwdEdit.textContent = "Cancel";
      } else {
        pwdInputGroup.style.display = "none";
        btnTogglePwdEdit.textContent = "Edit";
      }
    });
  }

  // 儲存密碼事件
  if (btnSetPwd && inputPwd) {
    btnSetPwd.addEventListener("click", async () => {
      const pwd = inputPwd.value.trim();
      if (!pwd) {
        alert(t("alert_input_static_password") || "Please enter a static access password.");
        return;
      }
      try {
        await invoke("set_static_password", { password: pwd });
        inputPwd.value = "";
        // 儲存後預設切換回隱碼
        if (inputPwd.type === "text") {
          inputPwd.type = "password";
          if (btnTogglePwd) btnTogglePwd.textContent = "Show";
        }
        await updateStaticPasswordStatus();
        showToast(t("toast_static_password_success") || "Unattended password saved successfully.");
      } catch (e) {
        alert((t("alert_set_static_password_fail") || "Failed to set password: ") + e);
      }
    });
  }

  // 一鍵刪除密碼事件
  if (btnDeletePwd) {
    btnDeletePwd.addEventListener("click", async () => {
      const confirmMsg = t("confirm_delete_static_password") || "Are you sure you want to delete the unattended password?";
      if (confirm(confirmMsg)) {
        try {
          await invoke("delete_static_password");
          inputPwd.value = "";
          if (inputPwd.type === "text") {
            inputPwd.type = "password";
            if (btnTogglePwd) btnTogglePwd.textContent = "Show";
          }
          await updateStaticPasswordStatus();
          showToast(t("toast_delete_static_password_success") || "Unattended password deleted successfully.");
        } catch (e) {
          alert((t("alert_delete_static_password_fail") || "Failed to delete password: ") + e);
        }
      }
    });
  }
}

// =========================================================================
// 剪貼簿雙向同步
// =========================================================================
function initClipboardSync() {
  // 主控端複製文字時 → 推送至被控端
  const onCopy = async (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData("text/plain") || "";
    if (!text || !dataChannelClipboard || dataChannelClipboard.readyState !== "open") return;
    try {
      const msg = JSON.stringify({ type: "clipboard_push", text });
      dataChannelClipboard.send(msg);
      console.log(t("log_clip_push_client"), text.substring(0, 40));
    } catch {}
  };
  document.addEventListener("copy", onCopy);

  // 被控端剪貼簿輪詢（每 1.5 秒透過 Tauri read_clipboard 讀取被控端）
  if (_clipboardPollInterval) clearInterval(_clipboardPollInterval);
  if (isDesktopTauri()) {
    _clipboardPollInterval = setInterval(async () => {
      if (!dataChannelClipboard || dataChannelClipboard.readyState !== "open") return;
      try {
        const remoteText = await invoke<string>("read_clipboard");
        if (remoteText && remoteText !== _lastRemoteClipboard) {
          _lastRemoteClipboard = remoteText;
          // 同步至主控端（Tauri 是被控端，推送至主控端的 DataChannel）
          // 注意：此路徑只在 Tauri Host 模式下運行
          // 被控端讀到自己的剪貼簿後推送給主控端
          const msg = JSON.stringify({ type: "clipboard_push", text: remoteText });
          dataChannelClipboard.send(msg);
          console.log(t("log_clip_push_host"), remoteText.substring(0, 40));
        }
      } catch {}
    }, 1500);
  }

  // 連線斷開時清理
  const originalCleanup = (window as any)._clipboardCleanup;
  (window as any)._clipboardCleanup = () => {
    document.removeEventListener("copy", onCopy);
    if (_clipboardPollInterval) { clearInterval(_clipboardPollInterval); _clipboardPollInterval = null; }
    if (originalCleanup) originalCleanup();
  };
}

// =========================================================================
// 首次執行提示：偵測是否為首次啟動且密碼尚未設定
// =========================================================================
async function initFirstRunPrompt() {
  // 僅在桌面端 Tauri Host 執行
  if (!isDesktopTauri()) return;

  // 若使用者已完成過首次設定流程，直接返回
  const alreadyOnboarded = localStorage.getItem("2syn_first_run_done");
  if (alreadyOnboarded === "1") return;

  // 即便已有密碼（例如從備份還原），也不再騷擾使用者
  try {
    const hasPwd = await invoke<boolean>("check_has_static_password");
    if (hasPwd) {
      localStorage.setItem("2syn_first_run_done", "1");
      return;
    }
  } catch (e) {
    console.warn("[FirstRun] 無法檢查密碼狀態:", e);
    return;
  }

  // 顯示首次執行提示 Modal
  const modal = document.getElementById("first-run-modal");
  if (!modal) return;
  modal.style.display = "flex";

  // 「前往設定」：關閉 modal、標記已完成、捲動至密碼區並聚焦
  const btnGo = document.getElementById("btn-first-run-go");
  if (btnGo) {
    btnGo.addEventListener("click", () => {
      modal.style.display = "none";
      localStorage.setItem("2syn_first_run_done", "1");

      // 捲動至靜態密碼設定區域
      const pwdSection = document.getElementById("input-static-pwd");
      if (pwdSection) {
        pwdSection.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => pwdSection.focus(), 400);
      }
    });
  }

  // 「稍後設定」：關閉 modal，但不標記完成（下次啟動仍會提示）
  const btnSkip = document.getElementById("btn-first-run-skip");
  if (btnSkip) {
    btnSkip.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }
}

// =========================================================================
// 地址簿 / 裝置常用裝置清單
// =========================================================================
interface SavedDevice {
  id: string;       // 9-digit device ID
  name: string;     // user-defined nickname
  lastConnected: string; // ISO timestamp or empty
  mac?: string;     // optional MAC address for Wake-on-LAN
}

const DEVICE_BOOK_KEY = "2syn_device_book";

function loadDeviceBook(): SavedDevice[] {
  try {
    const raw = localStorage.getItem(DEVICE_BOOK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDeviceBook(devices: SavedDevice[]) {
  localStorage.setItem(DEVICE_BOOK_KEY, JSON.stringify(devices));
}

function saveDeviceToBook(deviceId: string) {
  const devices = loadDeviceBook();
  const existing = devices.find(d => d.id === deviceId);
  if (existing) {
    existing.lastConnected = new Date().toISOString();
  } else {
    devices.unshift({ id: deviceId, name: deviceId, lastConnected: new Date().toISOString() });
  }
  saveDeviceBook(devices);
  renderDeviceBook();
}

function renderDeviceBook() {
  const list = document.getElementById("device-book-list");
  const emptyMsg = document.getElementById("device-book-empty-msg");
  if (!list) return;
  
  const devices = loadDeviceBook();
  list.innerHTML = "";
  
  if (devices.length === 0) {
    if (emptyMsg) emptyMsg.style.display = "block";
    return;
  }
  if (emptyMsg) emptyMsg.style.display = "none";
  
  devices.forEach(device => {
    const lastConnStr = device.lastConnected
      ? new Date(device.lastConnected).toLocaleString()
      : t("device_book_never");
    
    const macVal = device.mac || "";
    
    const card = document.createElement("div");
    card.className = "device-card";
    card.innerHTML = `
      <div class="device-card-info">
        <div class="device-card-name" contenteditable="true" data-id="${device.id}" 
             title="${t('device_book_name_placeholder')}">${device.name}</div>
        <div class="device-card-id">${device.id}</div>
        <div class="device-card-meta">MAC: <input type="text" class="device-mac-input" placeholder="AA:BB:CC:DD:EE:FF" value="${macVal}" /></div>
        <div class="device-card-meta">${t("device_book_last_connected")} ${lastConnStr}</div>
      </div>
      <div class="device-card-actions">
        ${device.mac ? `<button class="device-card-btn" onclick="deviceBookWake('${device.mac}')">Wake</button>` : ''}
        <button class="device-card-btn" onclick="deviceBookConnect('${device.id}')">${t("device_book_connect")}</button>
        <button class="device-card-btn danger" onclick="deviceBookDelete('${device.id}')">${t("device_book_delete")}</button>
      </div>
    `;
    
    // Inline name editing
    const nameEl = card.querySelector(".device-card-name") as HTMLElement;
    if (nameEl) {
      nameEl.addEventListener("blur", () => {
        const newName = nameEl.textContent?.trim() || device.id;
        const devices = loadDeviceBook();
        const d = devices.find(x => x.id === device.id);
        if (d) {
          d.name = newName;
          saveDeviceBook(devices);
        }
      });
      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); nameEl.blur(); }
      });
    }

    // MAC address editing
    const macEl = card.querySelector(".device-mac-input") as HTMLInputElement;
    if (macEl) {
      macEl.addEventListener("blur", () => {
        const newMac = macEl.value.trim();
        const devices = loadDeviceBook();
        const d = devices.find(x => x.id === device.id);
        if (d && d.mac !== newMac) {
          d.mac = newMac;
          saveDeviceBook(devices);
          renderDeviceBook(); // Re-render to show/hide Wake button
        }
      });
      macEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); macEl.blur(); }
      });
    }
    
    list.appendChild(card);
  });
}

(window as any).deviceBookConnect = (deviceId: string) => {
  const remoteIdInput = document.getElementById("remote-id-input") as HTMLInputElement;
  if (remoteIdInput) {
    remoteIdInput.value = deviceId;
    const btnConnect = document.getElementById("btn-connect");
    if (btnConnect) btnConnect.click();
  }
};

(window as any).deviceBookDelete = (deviceId: string) => {
  const devices = loadDeviceBook().filter(d => d.id !== deviceId);
  saveDeviceBook(devices);
  renderDeviceBook();
};

(window as any).deviceBookWake = async (mac: string) => {
  try {
    await invoke("wake_device", { mac });
    alert(t("wake_success") || "Magic Packet 已送出！");
  } catch (err) {
    console.error("WoL failed:", err);
    alert(`${t("wake_failed") || "喚醒失敗"}: ${err}`);
  }
};

(window as any).toggleDeviceBook = () => {
  const content = document.getElementById("device-book-content");
  const icon = document.getElementById("device-book-toggle-icon");
  if (!content) return;
  const isOpen = content.style.display !== "none";
  content.style.display = isOpen ? "none" : "block";
  if (icon) icon.style.transform = isOpen ? "" : "rotate(180deg)";
};

function initDeviceBook() {
  renderDeviceBook();

  // JSON Export / Import
  const btnExport = document.getElementById("btn-export-device-book");
  const btnImport = document.getElementById("btn-import-device-book");
  const inputImport = document.getElementById("input-import-device-book") as HTMLInputElement;

  if (btnExport) {
    btnExport.addEventListener("click", () => {
      const devices = loadDeviceBook();
      const jsonStr = JSON.stringify(devices, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `2syn_address_book_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (btnImport && inputImport) {
    btnImport.addEventListener("click", () => {
      inputImport.click();
    });

    inputImport.addEventListener("change", async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (!Array.isArray(imported)) throw new Error("Invalid format");
        
        // Merge strategy: overwrite by ID
        const existing = loadDeviceBook();
        const map = new Map();
        existing.forEach(d => map.set(d.id, d));
        
        for (const item of imported) {
          if (item && item.id) {
            map.set(item.id, item);
          }
        }
        
        saveDeviceBook(Array.from(map.values()));
        renderDeviceBook();
        inputImport.value = ""; // Reset input
      } catch (err) {
        console.error("Failed to parse imported JSON", err);
        alert(t("alert_import_failed_json"));
      }
    });
  }
}


// =========================================================================
// 信令客戶端：建立 WebSocket 連線並處理訊息路由
// =========================================================================
let heartbeatTimer: any = null;
function initSignalingClient() {
  const url = getSignalingUrl();
  console.log(t("log_sig_trying"), url);
  
  signalingWs = new WebSocket(url);
  
  signalingWs.onopen = () => {
    console.log(t("log_sig_connected_logging_in"));
    signalingWs!.send(JSON.stringify({ type: "login", id: myId }));
    
    let lastHeartbeatTime = Date.now();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      // 若兩次心跳的實際時間間隔大於 25 秒，代表計時器曾被系統掛起（例如 macOS App Nap 或行動端背景休眠）
      if (now - lastHeartbeatTime > 25000) {
        console.warn(t("log_sig_timer_delay"));
        if (signalingWs) {
          signalingWs.close();
        }
        return;
      }
      lastHeartbeatTime = now;
      if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
        signalingWs.send(JSON.stringify({ type: "ping" }));
      }
    }, 15000);
  };

  signalingWs.onmessage = async (event) => {
    let msg: any;
    try { msg = JSON.parse(event.data); } catch { return; }
    console.log("[Signaling] 收到:", msg);

    switch (msg.type) {
      case "offer":
        // 我們是被動端（被呼叫者），核對 PIN
        await handleIncomingOffer(msg.source, msg.sdp, msg.pin);
        break;
      case "answer":
        // 收到遠端回傳的 Answer
        if (peerConnection) {
          try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: msg.sdp }));
            console.log(t("log_webrtc_answer_applied"));
            flushIceCandidateQueue();
          } catch (e) {
            console.error("[WebRTC] 處理 Answer 失敗:", e);
          }
        }
        break;
      case "ice":
        // 收到遠端 ICE Candidate
        if (msg.candidate !== undefined && msg.candidate !== null && msg.candidate !== "null" && msg.candidate !== "") {
          if (peerConnection) {
            // 發起端 (Client) JS WebRTC 處理
            if (peerConnection.remoteDescription) {
              try {
                const candidateObj = JSON.parse(msg.candidate);
                await peerConnection.addIceCandidate(candidateObj);
              } catch (e) {
                console.warn("[WebRTC] 無法加入 ICE Candidate:", e);
              }
            } else {
              // peerConnection 尚未就緒或 remoteDescription 尚未設定，先加入佇列避免遺失
              iceCandidateQueue.push(JSON.parse(msg.candidate));
            }
          } else {
            // 被控端 (Host) Rust WebRTC 處理
            if (!rustOfferProcessed) {
              rustIceCandidateQueue.push(msg.candidate);
            } else {
              try {
                await invoke("add_ice_candidate_to_rust", { candidateStr: msg.candidate });
              } catch (e) {
                console.warn("[WebRTC] 無法將 ICE Candidate 傳遞給 Rust:", e);
              }
            }
          }
        }
        break;
      case "custom_request_logs":
        {
          const logOverlay = document.getElementById("debug-overlay");
          const logsList: string[] = [];
          if (logOverlay) {
            Array.from(logOverlay.children).forEach((child) => {
              logsList.push(child.textContent || "");
            });
          }
          if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
            signalingWs.send(JSON.stringify({
              type: "custom_response_logs",
              target: msg.source,
              source: myId,
              logs: logsList.slice(-35) // 回傳最近 35 條日誌，避免數據過大
            }));
          }
        }
        break;
      case "custom_response_logs":
        {
          const remoteLogs = msg.logs || [];
          const container = document.getElementById("remote-logs-container");
          if (container) {
            if (remoteLogs.length === 0) {
              container.textContent = "No log records received from remote host.";
            } else {
              container.innerHTML = "";
              remoteLogs.forEach((log: string) => {
                const div = document.createElement("div");
                if (log.includes("失敗") || log.includes("failed") || log.includes("Error") || log.includes("錯誤") || log.includes("err_")) {
                  div.style.color = "#f87171"; // 紅色
                } else if (log.includes("警告") || log.includes("warn") || log.includes("Warning") || log.includes("timeout")) {
                  div.style.color = "#fbbf24"; // 黃色
                } else {
                  div.style.color = "#34d399"; // 綠色
                }
                div.textContent = log;
                container.appendChild(div);
              });
              container.scrollTop = container.scrollHeight;
            }
          }
        }
        break;
      case "error":
        console.error("[Signaling] 伺服器錯誤:", msg.message);
        if (msg.message === "Target offline") {
          const offlineMsg = t("err_target_offline");
          const btnConnect = document.getElementById("btn-connect");
          if (btnConnect) {
            btnConnect.textContent = offlineMsg;
            btnConnect.style.backgroundColor = "#e74c3c";
            setTimeout(() => {
              btnConnect.textContent = t("btn_connect");
              btnConnect.style.backgroundColor = "";
            }, 3000);
          }
          resetConnectionUI();
        } else if (msg.message.includes("Connection rejected")) {
          const rejectMsg = t("err_rejected");
          const btnConnect = document.getElementById("btn-connect");
          if (btnConnect) {
            btnConnect.textContent = rejectMsg;
            btnConnect.style.backgroundColor = "#e74c3c";
            setTimeout(() => {
              btnConnect.textContent = t("btn_connect");
              btnConnect.style.backgroundColor = "";
            }, 3000);
          }
          resetConnectionUI();
        }
        break;
    }
  };

  signalingWs.onclose = function(this: WebSocket) {
    console.warn("[Signaling] WebSocket 已斷線，5 秒後重新嘗試...");
    if (signalingWs === this) {
      signalingWs = null;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      setTimeout(initSignalingClient, 5000);
    }
  };

  signalingWs.onerror = (err) => {
    console.error("[Signaling] 連線錯誤:", err);
  };
}

// =========================================================================
// WebRTC：建立 PeerConnection 並掛載 Data Channels
// =========================================================================

async function flushIceCandidateQueue() {
  if (peerConnection && peerConnection.remoteDescription) {
    while (iceCandidateQueue.length > 0) {
      const candidate = iceCandidateQueue.shift();
      try {
        await peerConnection.addIceCandidate(candidate);
      } catch (e) {
        console.warn("[WebRTC] 從佇列加入 ICE Candidate 失敗:", e);
      }
    }
  }
}

function createPeerConnection(remoteId: string): RTCPeerConnection {
  // 若已有舊連線，先關閉
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
    dataChannelControl = null;
    iceCandidateQueue = [];
  }

  currentRemoteId = remoteId;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // --- WebRTC State Debug Listeners ---
  pc.oniceconnectionstatechange = () => {
    console.log(`[WebRTC] ICE Connection State: ${pc.iceConnectionState}`);
  };
  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] Connection State: ${pc.connectionState}`);
  };
  pc.onicegatheringstatechange = () => {
    console.log(`[WebRTC] ICE Gathering State: ${pc.iceGatheringState}`);
  };
  pc.onsignalingstatechange = () => {
    console.log(`[WebRTC] Signaling State: ${pc.signalingState}`);
  };
  pc.onnegotiationneeded = () => {
    console.log(`[WebRTC] Negotiation Needed`);
  };
  // ------------------------------------

  // 當 ICE Candidate 產生時，轉發給信令伺服器（包含 end-of-candidates）
  pc.onicecandidate = (event) => {
    if (signalingWs?.readyState === WebSocket.OPEN) {
      signalingWs.send(JSON.stringify({
        type: "ice",
        target: remoteId,
        candidate: JSON.stringify(event.candidate),
      }));
    }
  };

  // 監聽連線狀態變化
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    console.log(t("log_webrtc_state"), state);
    updateConnectionStatusUI(state);
  };

  // 被動端：接收遠端建立的 Data Channels
  pc.ondatachannel = (event) => {
    const ch = event.channel;
    if (ch.label === "input-control") {
      dataChannelControl = ch;
      bindControlChannel(ch);
    }
  };

  // 接收遠端視訊軌道 (只會在 iPhone / Client 端發生，因為 Mac 是 Host)
  pc.ontrack = (event) => {
    console.log("[WebRTC] 收到遠端視訊軌道:", event.track.kind);
    if (event.track.kind === "video") {
        // ★ 低延遲調校：遠端控制場景應「犧牲平滑、優先低延遲」。
        // 量測顯示 RTT 僅 ~10ms，但接收端 jitter buffer 為抗抖動把緩衝撐到近 900ms，
        // 成為端到端延遲的絕對主因。下面把 jitter buffer 目標壓到最低，讓畫面變化
        // 幾乎即時呈現（代價：偶發抖動時可能輕微跳幀，但操控跟手感大幅提升）。
        try {
          const r = event.receiver as any;
          if (r) {
            if ("jitterBufferTarget" in r) r.jitterBufferTarget = 0;       // 標準 API（ms）
            if ("playoutDelayHint" in r) r.playoutDelayHint = 0;           // Chromium 舊 API（秒）
          }
        } catch (e) {
          console.warn("[WebRTC] 設定低延遲 jitter buffer 失敗:", e);
        }
        // --- UI Setup ---
        const videoEl = document.getElementById("remote-video") as HTMLVideoElement;
        const videoContainer = document.getElementById("remote-video-container") as HTMLElement;
        const btnDisplayMode = document.getElementById("btn-display-mode") as HTMLButtonElement;
        const btnAudioToggle = document.getElementById("btn-audio-toggle") as HTMLButtonElement;
        const mainContent = document.querySelector(".glass-container") as HTMLElement;
        if (videoEl) videoEl.style.cursor = "default"; // 讓原生硬體游標保持顯示，達成零延遲操控體驗
        if (videoContainer) {
          videoContainer.style.display = "block";
          videoContainer.focus();
        }
        if (btnDisplayMode) btnDisplayMode.style.display = "block";
        if (btnAudioToggle) btnAudioToggle.style.display = "block";
        if (mainContent) mainContent.style.display = "none";

        // Quick Menu 已移除：保持隱藏，不要覆寫 HTML 的 display:none !important
        const mobileControlOrb = document.getElementById("mobile-control-orb");
        if (mobileControlOrb) mobileControlOrb.style.display = "none";
        // Support dual-track foveated streaming
        const stream = event.streams && event.streams.length > 0 
            ? event.streams[0] 
            : new MediaStream([event.track]);
        const isFoveated = event.track.id === "foveated" || event.track.label === "foveated";

        if (isFoveated) {
            console.log("[WebRTC] 收到感知優先 (Foveated) 軌道");
            let fv = document.getElementById("foveated-video") as HTMLVideoElement;
            if (!fv) {
               fv = document.createElement("video");
               fv.id = "foveated-video";
               fv.autoplay = true;
               fv.playsInline = true;
               fv.muted = true;
               fv.style.position = "absolute";
               fv.style.pointerEvents = "none";
               fv.style.mixBlendMode = "normal";
               fv.style.width = "400px";
               fv.style.height = "400px";
               fv.style.borderRadius = "200px"; // 聚焦圓形
               fv.style.boxShadow = "0 0 20px rgba(0,0,0,0.5)";
               fv.style.zIndex = "100";
               videoContainer.appendChild(fv);
               
               // 讓聚焦影片層跟隨前端游標
               window.addEventListener("mousemove", (e) => {
                 fv.style.left = `${e.clientX - 200}px`;
                 fv.style.top = `${e.clientY - 200}px`;
               });
            }
            fv.srcObject = stream;
            return; // 結束，不覆蓋背景軌道
        }

        if (!videoEl.srcObject) {
          // 強制僅綁定視訊軌道，避免 iOS Safari 因為混入音訊軌道而無條件阻擋 autoplay
          videoEl.srcObject = new MediaStream([event.track]);
            
          // 啟用零延遲渲染 (Zero-Latency Rendering)
          if ((videoEl as any).playoutDelayHint !== undefined) {
            (videoEl as any).playoutDelayHint = 0;
          }
          videoEl.playsInline = true;
          videoEl.muted = true; // 雙重保障：iOS 自動播放安全策略必須為靜音
          videoEl.disablePictureInPicture = true;
          
          // 註冊黑屏偵測與強制播放處理
          const videoErrorOverlay = document.getElementById("video-error-overlay");
          const btnVideoRetryPlay = document.getElementById("btn-video-retry-play");
          const btnVideoErrorClose = document.getElementById("btn-video-error-close");
          
          let hasPlayed = false;
          
          videoEl.onplaying = () => {
            hasPlayed = true;
            if (videoErrorOverlay) videoErrorOverlay.style.display = "none";
            // 連線後立即在畫面中央顯示游標，讓使用者知道游標位置
            if (!HOST_RENDERS_CURSOR && !isDesktopTauri()) {
              const rc = document.getElementById("remote-cursor-indicator");
              if (rc) {
                const vr = videoEl.getBoundingClientRect();
                rc.style.left = `${vr.left + vr.width / 2}px`;
                rc.style.top = `${vr.top + vr.height / 2}px`;
                rc.style.display = "block";
              }
            }
          };
          
          if (btnVideoRetryPlay) {
            btnVideoRetryPlay.onclick = () => {
              videoEl.play().then(() => {
                hasPlayed = true;
                if (videoErrorOverlay) videoErrorOverlay.style.display = "none";
              }).catch(err => {
                console.error("[WebRTC] 強制手動播放失敗:", err);
                alert("Autoplay blocked. Please click the screen to allow video playback.");
              });
            };
          }
          
          if (btnVideoErrorClose) {
            btnVideoErrorClose.onclick = () => {
              if (videoErrorOverlay) videoErrorOverlay.style.display = "none";
            };
          }
          
          // 4 秒後偵測是否仍在黑屏狀態
          setTimeout(() => {
            if (!hasPlayed || videoEl.paused || videoEl.currentTime === 0) {
              console.warn(t("log_webrtc_black_screen"));
              if (videoErrorOverlay) videoErrorOverlay.style.display = "flex";
            }
          }, 4000);

          try {
            videoEl.play().catch(err => {
              console.warn("[WebRTC] 視訊自動播放受阻，等待手動啟動或黑屏提示:", err);
            });
            setupInputControl(videoEl); // 綁定輸入控制
          } catch (err) {
            console.error("[WebRTC] 視訊播放調用失敗:", err);
          }
        }
    } else if (event.track.kind === "audio") {
        console.log("[WebRTC] 收到遠端音訊軌道");
        let audioEl = document.getElementById("remote-audio") as HTMLAudioElement;
        if (!audioEl) {
            audioEl = document.createElement("audio");
            audioEl.id = "remote-audio";
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
        }
        
        if (!audioEl.srcObject) {
            audioEl.srcObject = event.streams && event.streams.length > 0 
                ? event.streams[0] 
                : new MediaStream([event.track]);
                
            try {
                audioEl.play().catch(err => {
                    console.warn("[WebRTC] 音訊自動播放受阻，等待使用者互動:", err);
                });
            } catch (err) {
                console.error("[WebRTC] 音訊播放調用失敗:", err);
            }
        }
    }
  };

  return pc;
}

// 主動端：建立 Data Channels 並發起 Offer
async function startCall(remoteId: string, pin: string) {
  if (!signalingWs || signalingWs.readyState !== WebSocket.OPEN) {
    alert(t("err_signaling_offline"));
    resetConnectionUI();
    return;
  }

  try {
    const pc = createPeerConnection(remoteId);
    peerConnection = pc;

    // 主動端建立 Data Channels
    dataChannelControl = pc.createDataChannel("input-control", {
      ordered: true,
    });
    bindControlChannel(dataChannelControl);

    dataChannelUnreliable = pc.createDataChannel("input-unreliable", {
      ordered: false,
      maxRetransmits: 0,
    });
    bindUnreliableChannel(dataChannelUnreliable);

    dataChannelSystemControl = pc.createDataChannel("system-control", { ordered: true });
    bindSystemControlChannel(dataChannelSystemControl);

    // 檔案傳輸 DataChannel
    dataChannelFileTransfer = pc.createDataChannel("file-transfer", { ordered: true });
    
    // 剪貼簿同步 DataChannel
    dataChannelClipboard = pc.createDataChannel("clipboard", { ordered: true });
    dataChannelClipboard.onopen = () => {
      console.log("[clipboard] DataChannel opened");
      initClipboardSync();
    };
    dataChannelClipboard.onmessage = (ev) => {
      // 被控端推送剪貼簿至主控端（被控→主控方向）
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "clipboard_push" && msg.text) {
          navigator.clipboard.writeText(msg.text).catch(() => {});
          console.log(`[clipboard] 收到被控端剪貼簿: ${msg.text.substring(0, 40)}`);
        }
      } catch {}
    };

    // 要求接收視訊軌道 (加入 m=video 至 SDP Offer)
    pc.addTransceiver("video", { direction: "recvonly" });
    // 要求接收音訊軌道 (加入 m=audio 至 SDP Offer)
    pc.addTransceiver("audio", { direction: "recvonly" });

    // 產生 SDP Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // 透過信令伺服器轉發 Offer（含 PIN）
    signalingWs.send(JSON.stringify({
      type: "offer",
      target: remoteId,
      pin: pin,
      sdp: offer.sdp,
    }));
  } catch (e) {
    console.error("[WebRTC] startCall 嚴重錯誤:", e);
    alert(t("alert_connect_failed") + String(e));
    resetConnectionUI();
  }

  console.log(t("log_webrtc_offer_sent"), remoteId);
}

// 被動端：收到 Offer，驗證 PIN 後回傳 Answer
async function handleIncomingOffer(sourceId: string, sdpString: string, incomingPin?: string) {
  // 1. 檢查本機授權狀態（作為被控端，必須有有效授權或在試用期內）
  try {
    const isWebBrowser = !isDesktopTauri();
    if (!isWebBrowser) {
      const licenseState = await invoke<{status: string, trial_days_left: number | null}>("check_license_status");
      if (licenseState.status === "expired" || licenseState.status === "unauthorized") {
        console.warn(t("log_webrtc_trial_expired"), licenseState.status);
        alert(t("err_host_expired") || "Host trial period has expired. Please enter a valid license key.");
        if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
          signalingWs.send(JSON.stringify({
            type: "error",
            target: sourceId,
            message: "Connection rejected: Host trial expired"
          }));
        }
        return;
      }
    }
  } catch (e) {
    console.warn("授權狀態檢查失敗，為安全起見拒絕連線:", e);
    return;
  }

  rustOfferProcessed = false;
  rustIceCandidateQueue = [];
  currentRemoteId = sourceId;

  // 2. 驗證無人值守密碼 (靜態無人值守密碼為唯一連線驗證金鑰)
  let isStaticValid = false;
  if (incomingPin) {
    try {
      isStaticValid = await invoke("verify_static_password", { password: incomingPin });
    } catch (e) {
      console.warn("驗證無人值守密碼時發生錯誤:", e);
    }
  }

  if (!isStaticValid) {
    console.warn(t("log_webrtc_pwd_mismatch"));
    if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
      signalingWs.send(JSON.stringify({
        type: "error",
        target: sourceId,
        message: "Connection rejected: Invalid Password"
      }));
    }
    return;
  }

  try {
    // 轉交給 Rust 後端處理 WebRTC (方案 C: 啟動 Rust-native WebRTC 與硬體螢幕擷取)
    console.log("[WebRTC] 交由 Rust 處理遠端 Offer...");
    const answerSdp: string = await invoke("handle_remote_offer_as_host", { offerSdp: sdpString });

    // 回傳 Rust 產生的 Answer 給發起方
    if (signalingWs?.readyState === WebSocket.OPEN) {
      signalingWs.send(JSON.stringify({
        type: "answer",
        target: sourceId,
        sdp: answerSdp,
      }));
    }
    console.log(`[WebRTC] Rust Answer 已回傳給 ${sourceId}`);
    
    // 標記 Offer 處理完畢，開始處理駐留在佇列中的 ICE Candidates
    rustOfferProcessed = true;
    while (rustIceCandidateQueue.length > 0) {
      const cand = rustIceCandidateQueue.shift();
      if (cand && cand !== "null") {
        try {
          await invoke("add_ice_candidate_to_rust", { candidateStr: cand });
        } catch (e) {
          console.warn("[WebRTC] 從佇列傳遞 ICE Candidate 給 Rust 失敗:", e);
        }
      }
    }
  } catch (e) {
    console.error("[WebRTC] handle_remote_offer_as_host 發生嚴重錯誤:", e);
    alert(t("alert_handle_remote_offer_failed") + String(e));
  }
}

// 控制通道（滑鼠鍵盤）綁定：收到遠端控制指令交由 Rust 執行
function bindControlChannel(ch: RTCDataChannel) {
  ch.onopen = () => console.log("[DataChannel] input-control 已開啟");
  ch.onclose = () => console.log("[DataChannel] input-control 已關閉");
  ch.onmessage = async (event) => {
    try {
      const data: Uint8Array = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : new Uint8Array(await event.data.arrayBuffer());
      // 交由 Rust 後端執行實際的滑鼠/鍵盤操作
      await invoke("handle_remote_input", { data: Array.from(data) });
    } catch (e) {
      console.error("[Control] 執行遠端輸入失敗:", e);
    }
  };
}

// 非可靠控制通道綁定
function bindUnreliableChannel(ch: RTCDataChannel) {
  ch.onopen = () => console.log("[DataChannel] input-unreliable 已開啟");
  ch.onclose = () => console.log("[DataChannel] input-unreliable 已關閉");
  ch.onmessage = async (event) => {
    try {
      const data: Uint8Array = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : new Uint8Array(await event.data.arrayBuffer());
      // 交由 Rust 後端執行實際的滑鼠操作 (MouseMove 等)
      await invoke("handle_remote_input", { data: Array.from(data) });
    } catch (e) {
      console.error("[Control-Unreliable] 執行遠端輸入失敗:", e);
    }
  };
}

function bindSystemControlChannel(ch: RTCDataChannel) {
  ch.onopen = () => console.log("[DataChannel] system-control 已開啟");
  ch.onclose = () => console.log("[DataChannel] system-control 已關閉");
  ch.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "monitor_list") {
        availableMonitors = msg.monitors;
        currentMonitorIndex = msg.current;
        console.log("[system-control] 收到螢幕清單:", availableMonitors);
        
        const btnSwitchMonitor = document.getElementById("btn-switch-monitor") as HTMLButtonElement;
        if (btnSwitchMonitor && availableMonitors.length > 1) {
          btnSwitchMonitor.style.display = "block";
          btnSwitchMonitor.textContent = `🖥️ ${availableMonitors[currentMonitorIndex].name}`;
        }
      }
    } catch (e) {
      console.error("[system-control] JSON parse error:", e);
    }
  };
}



// 重置連線相關 UI 狀態
function resetConnectionUI() {
  const btnConnect = document.getElementById("btn-connect");
  const btnText = document.getElementById("txt-btn-connect");
  if (btnConnect) btnConnect.removeAttribute("disabled");
  if (btnText) btnText.textContent = t("btn_connect") || "Connect";

  const videoEl = document.getElementById("remote-video") as HTMLVideoElement;
  const mainContent = document.querySelector(".glass-container") as HTMLElement;
  const videoContainer = document.getElementById("remote-video-container") as HTMLElement;
  const btnDisplayMode = document.getElementById("btn-display-mode") as HTMLButtonElement;

  if (videoContainer) {
    videoContainer.style.display = "none";
  }
  if (videoEl) {
    videoEl.srcObject = null;
    videoEl.style.objectFit = "contain";
    videoEl.style.width = "100%";
    videoEl.style.height = "100%";
  }
  if (btnDisplayMode) {
    btnDisplayMode.style.display = "none";
    btnDisplayMode.textContent = "🔍 Original Size";
  }
  if (mainContent) {
    mainContent.style.display = "flex";
  }
  // 移除診斷 HUD
  document.getElementById("diag-hud")?.remove();

  const mobileControlOrb = document.getElementById("mobile-control-orb");
  if (mobileControlOrb) {
    mobileControlOrb.style.display = "none";
  }
  const sessionToolbar = document.getElementById("session-toolbar");
  if (sessionToolbar) {
    sessionToolbar.style.display = "none";
  }
  const toolbarActions = document.getElementById("toolbar-actions");
  if (toolbarActions) {
    toolbarActions.style.display = "none"; // 重置為收合
  }

  // 重置 Quick Menu 面板狀態為關閉
  isPanelOpen = false;
  const controlPanel = document.getElementById("control-dock-panel");
  const toggleArrow = document.getElementById("control-toggle-arrow");
  const shortcutsDropdown = document.getElementById("shortcuts-dropdown");
  if (controlPanel) {
    controlPanel.style.maxHeight = "0px";
    controlPanel.style.opacity = "0";
    controlPanel.style.pointerEvents = "none";
    controlPanel.style.transform = "translateY(-10px)";
  }
  if (toggleArrow) {
    toggleArrow.textContent = "▼";
    toggleArrow.style.transform = "rotate(0deg)";
  }
  if (shortcutsDropdown) {
    shortcutsDropdown.style.display = "none";
  }

  // 重置顯示模式狀態與隱藏懸浮手勢工具輪
  resetDisplayMode();
}

// 依照 WebRTC connectionState 更新 UI 提示
function updateConnectionStatusUI(state: string) {
  const statusMap: Record<string, string> = {
    connecting: t("conn_connecting"),
    connected:  t("conn_connected"),
    disconnected: t("conn_disconnected"),
    failed:     t("conn_failed"),
    closed:     t("conn_closed"),
  };

  const label = statusMap[state];
  if (label) {
    // 更新連線按鈕文字以提供即時回饋
    const btnText = document.getElementById("txt-btn-connect");
    if (btnText && state !== "connected") {
      btnText.textContent = label;
    } else if (btnText && state === "connected") {
      btnText.textContent = label;
      // 連線成功後恢復按鈕可用（用來發起中斷）
      const btnConnect = document.getElementById("btn-connect");
      if (btnConnect) btnConnect.removeAttribute("disabled");
      
      // 連線成功後自動儲存到地址簿
      if (currentRemoteId && currentRemoteId !== "manual") {
        saveDeviceToBook(currentRemoteId);
      }
    }
  }
  const videoContainer = document.getElementById("remote-video-container");
  if (state === "failed" || state === "disconnected" || state === "closed") {
    // 斷線時，強制關閉可能開啟的隱私黑屏模式，避免主機卡在黑屏
    const chkPrivacy = document.getElementById("chk-privacy-mode") as HTMLInputElement;
    if (chkPrivacy && chkPrivacy.checked) {
      chkPrivacy.checked = false;
      invoke("toggle_privacy_mode", { enable: false }).catch(e => console.warn("Failed to reset privacy mode:", e));
      console.log("[security] Connection dropped, privacy mode forcefully disabled to prevent lockout.");
    }
    // 無縫重連：將畫面轉為半透明灰階凍結，不立即報錯關閉
    if (videoContainer) {
      videoContainer.style.filter = "grayscale(100%) opacity(50%)";
      videoContainer.style.transition = "filter 0.5s ease";
    }
  } else if (state === "connected") {
    if (videoContainer) {
      videoContainer.style.filter = "none";
    }
  }

  if (state === "failed") {
    alert(t("err_rtc_failed"));
    const fixBtn = document.getElementById("btn-fix-network");
    if (fixBtn && fixBtn.style.display !== "none") {
        fixBtn.classList.add("pulse-highlight");
        setTimeout(() => fixBtn.classList.remove("pulse-highlight"), 5000);
    }
    resetConnectionUI();
  } else if (state === "disconnected" || state === "closed") {
    resetConnectionUI();
  }
}

// =========================================================================
// 初始化「開始連線」按鈕事件
// =========================================================================
function initConnectButton() {
  const btnFixNetwork = document.getElementById('btn-fix-network');
  const networkIndicator = document.getElementById('network-health-indicator');
  const networkText = document.getElementById('network-health-text');
  const networkDesc = document.getElementById('network-health-desc');

  if (btnFixNetwork) {
    btnFixNetwork.addEventListener('click', () => {
      const guideModal = document.getElementById("tailscale-guide-modal");
      if (guideModal) {
        guideModal.style.display = "flex";
      }
    });
  }

  if (isDesktopTauri()) {
    // 監聽來自 Rust 的影像擷取與編碼狀態 (例如沒有權限、編碼失敗等)
  listen<string>('rust-video-status', (event) => {
    console.error(`[WebRTC-Video] 影像處理發生問題: ${event.payload}`);
  });

  listen<any>('rust-webrtc-state', (event) => {
    console.log(`[WebRTC-Rust] 狀態變更: ${event.payload}`);
  });


  // 定期檢查網路體質
  if (networkIndicator && networkText && networkDesc && btnFixNetwork) {
    setInterval(async () => {
      try {
        const res: any = await invoke('check_network_health');
        if (res.has_tailscale) {
          networkIndicator.style.backgroundColor = 'var(--success-color, #10b981)';
          networkText.textContent = 'Excellent (P2P Ready)';
          networkText.style.color = 'var(--success-color, #10b981)';
          networkDesc.textContent = t("desc_tailscale_detected");
          btnFixNetwork.style.display = 'none';
        } else if (res.has_ipv6) {
          networkIndicator.style.backgroundColor = '#fbbf24'; // Warning color (yellow)
          networkText.textContent = 'Good (IPv6 Available)';
          networkText.style.color = '#fbbf24';
          networkDesc.textContent = t("desc_ipv6_detected");
          btnFixNetwork.style.display = 'inline-block';
        } else {
          networkIndicator.style.backgroundColor = '#ef4444'; // Error color (red)
          networkText.textContent = 'Poor (CGNAT / IPv4 Only)';
          networkText.style.color = '#ef4444';
          networkDesc.textContent = t("desc_nat_warning");
          btnFixNetwork.style.display = 'inline-block';
        }
      } catch (e) {
        console.warn('Network health check failed:', e);
      }
    }, 5000);
    // 立即執行一次
    invoke('check_network_health').catch(() => {});
  }

  listen('rust-ice-candidate', (event: any) => {
    console.log("[WebRTC] 攔截到 Rust 產生的 ICE Candidate, 準備透過 WebSocket 轉發");
    if (signalingWs && signalingWs.readyState === WebSocket.OPEN && currentRemoteId) {
      signalingWs.send(JSON.stringify({
        type: "ice",
        target: currentRemoteId,
        candidate: JSON.stringify(event.payload)
      }));
    }
  });

    }

  const btnConnect = document.getElementById("btn-connect");
  const remoteIdInput = document.getElementById("remote-id-input") as HTMLInputElement;
  const accessPinInput = document.getElementById("access-pin-input") as HTMLInputElement;

  if (!btnConnect || !remoteIdInput || !accessPinInput) return;

  btnConnect.addEventListener("click", async () => {
    const remoteId = remoteIdInput.value.trim().replace(/-/g, "");
    const pin = accessPinInput.value.trim().replace(/-/g, "");

    if (!remoteId || remoteId.length !== 9) {
      alert(t("err_invalid_remote_id"));
      return;
    }
    if (!pin || pin.length < 4) {
      alert(t("err_invalid_pin"));
      return;
    }

    btnConnect.setAttribute("disabled", "true");
    const btnText = document.getElementById("txt-btn-connect");
    if (btnText) btnText.textContent = t("conn_connecting");

    console.log(t("log_frontend_webrtc_init"), remoteId);
    // 真正的 WebRTC 連線發起
    await startCall(remoteId, pin);
  });
}



// 隱私黑屏模式切換
function initPrivacyMode() {
  const chkPrivacy = document.getElementById("chk-privacy-mode") as HTMLInputElement;
  if (chkPrivacy) {
    chkPrivacy.addEventListener("change", async () => {
      if (!isDesktopTauri()) {
        chkPrivacy.checked = !chkPrivacy.checked;
        return;
      }
      try {
        const msg = await invoke<string>("toggle_privacy_mode", { enable: chkPrivacy.checked });
        console.log(msg);
      } catch (error) {
        console.error("切換隱私模式失敗:", error);
        chkPrivacy.checked = !chkPrivacy.checked;
      }
    });
  }
}

// 模擬網路參數異動並傳遞至後端決策樹
async function updateNetworkSimulation() {
  if (!isDesktopTauri()) return;
  const rttInput = document.getElementById("range-rtt") as HTMLInputElement;
  const lossInput = document.getElementById("range-loss") as HTMLInputElement;
  const chkRelay = document.getElementById("chk-sim-relay") as HTMLInputElement;

  const rttVal = document.getElementById("val-sim-rtt");
  const lossVal = document.getElementById("val-sim-loss");

  if (rttInput && lossInput && chkRelay) {
    const rtt = parseInt(rttInput.value);
    const loss = parseFloat(lossInput.value) / 100.0;
    const isRelay = chkRelay.checked;

    if (rttVal) rttVal.textContent = `${rtt} ms`;
    if (lossVal) lossVal.textContent = `${lossInput.value}%`;

    try {
      await invoke("trigger_network_simulation", {
        rttMs: rtt,
        lossRate: loss,
        isRelay: isRelay
      });
    } catch (e) {
      console.error(e);
    }
  }
}

// 初始化模擬器參數異動監聽
function initNetworkSimulator() {
  const rttInput = document.getElementById("range-rtt");
  const lossInput = document.getElementById("range-loss");
  const chkRelay = document.getElementById("chk-sim-relay");

  const rttVal = document.getElementById("val-sim-rtt");
  const lossVal = document.getElementById("val-sim-loss");

  if (rttInput && lossInput && chkRelay) {
    rttInput.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      if (rttVal) rttVal.textContent = `${target.value} ms`;
      updateNetworkSimulation();
    });

    lossInput.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      if (lossVal) lossVal.textContent = `${target.value}%`;
      updateNetworkSimulation();
    });

    chkRelay.addEventListener("change", () => {
      updateNetworkSimulation();
    });
  }
}

// 週期性輪詢後端，獲取經過智慧連線與降級決策樹計算的即時配置
function startStatusPolling() {
  // 注意：以下 get_connection_status 輪詢是「被控端 host」專屬（讀後端 ABR 配置），
  // 僅在桌面 Tauri 環境跑；但底下的 WebRTC getStats 診斷迴圈必須在「控制端手機」
  // 也跑（收視訊的一端才量得到端到端延遲），故不可被此守衛一併擋掉。
  if (isDesktopTauri()) {
  setInterval(async () => {
    try {
      const status = await invoke<any>("get_connection_status");
      
      setTextContent("val-metric-fps", `${status.target_fps} fps`);
      
      const colorText = t(status.color_format);
      setTextContent("val-metric-color", colorText);
      
      setTextContent("val-metric-bitrate", `${(status.bitrate_limit_kbps / 1000).toFixed(1)} Mbps`);
      


      // 動態更新即時連線與加密性能指標
      setTextContent("val-metric-rtt", `${status.rtt_ms} ms`);
      setTextContent("val-metric-loss", `${(status.packet_loss_rate * 100).toFixed(1)}%`);

      const protocolText = status.connection_type === "P2PDirect"
        ? t("protocol_p2p")
        : t("protocol_relay");
      setTextContent("val-metric-protocol", protocolText);

      const encryptionText = t("encryption_gcu");
      setTextContent("val-metric-encryption", encryptionText);
    } catch (error: any) {
      if (typeof error === 'string' && error.includes("not found")) return;
      console.error("狀態輪詢出錯:", error);
    }
  }, 500);
  } // end if (isDesktopTauri())

  // WebRTC 原生 getStats() — 採集真實 inbound-rtp 統計（每 2 秒）
  // ★ 此迴圈在控制端手機也要跑，不受上方 isDesktopTauri 守衛限制 ★
  let _lastBytesReceived = 0;
  let _lastStatsTime = performance.now();
  // 診斷用累積值快照（用於計算各指標的「區間差分」，反映當下而非開機至今平均）
  const _prev = {
    framesDecoded: 0,
    jbDelay: 0,            // jitterBufferDelay (秒, 累積)
    jbCount: 0,            // jitterBufferEmittedCount (累積)
    interFrame: 0,         // totalInterFrameDelay (秒, 累積)
    interFrameSq: 0,       // totalSquaredInterFrameDelay (秒^2, 累積)
    decodeTime: 0,         // totalDecodeTime (秒, 累積)
    freezeCount: 0,
    freezeDur: 0,          // totalFreezesDuration (秒, 累積)
    framesDropped: 0,
    ready: false,
  };
  // 把診斷字串輸出到「浮動 HUD」。為求在任何情況下都看得到，HUD 直接掛在 document.body、
  // 用 position:fixed + 最高 z-index，不依賴視訊容器的堆疊脈絡或顯示狀態。
  // 同步寫入 debug overlay 與 console 以利桌面端排查。
  const logDiag = (msg: string) => {
    console.log(msg);
    const overlay = document.getElementById("debug-overlay");
    if (overlay) {
      const line = document.createElement("div");
      line.textContent = msg;
      line.style.color = "#38bdf8";
      overlay.appendChild(line);
      while (overlay.children.length > 100) overlay.removeChild(overlay.firstChild!);
      overlay.scrollTop = overlay.scrollHeight;
    }
    let hud = document.getElementById("diag-hud");
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "diag-hud";
      hud.style.cssText = "position:fixed;top:max(env(safe-area-inset-top),8px);left:8px;z-index:2147483647;max-width:94vw;background:rgba(0,0,0,0.66);color:#7dd3fc;font-family:ui-monospace,monospace;font-size:10px;line-height:1.45;padding:6px 8px;border-radius:8px;pointer-events:none;white-space:pre-wrap;";
      document.body.appendChild(hud);
    }
    hud.dataset.live = "1"; // 真正的診斷數據接管，自檢心跳讓出畫面
    const prev = (hud.textContent || "").replace(/^HUD 自檢.*$/m, "").split("\n").filter(Boolean).slice(-3);
    prev.push(msg.replace(/^\[DIAG\] /, ""));
    hud.textContent = prev.slice(-4).join("\n");
  };

  let _diagTick = 0;
  setInterval(async () => {
    _diagTick++;
    // 無 peerConnection（被控端/未連線）時靜默返回，避免刷屏汙染系統日誌。
    // 控制端一旦建立連線即自動開始輸出真實診斷數據。
    if (!peerConnection) return;
    let statsReport: any;
    try {
      statsReport = await peerConnection.getStats();
    } catch (err: any) {
      logDiag(`[DIAG] #${_diagTick} getStats() 失敗: ${err?.message || err}`);
      return;
    }
    try {
      let actualFps = 0;
      let bytesReceivedDelta = 0;
      let rttMs = 0;
      let packetsLost = 0;
      let packetsReceived = 0;
      let candidatePairFound = false;
      let vid: any = null; // inbound-rtp video 原始統計，供診斷差分使用

      statsReport.forEach((stat: RTCStatsReport) => {
        const s = stat as any;
        // inbound-rtp video（部分 WebView 用 mediaType 而非 kind）
        if (s.type === "inbound-rtp" && (s.kind === "video" || s.mediaType === "video")) {
          vid = s;
          actualFps = s.framesPerSecond ?? 0;
          const totalBytes = s.bytesReceived ?? 0;
          const now = performance.now();
          const elapsed = (now - _lastStatsTime) / 1000;
          if (elapsed > 0) {
            bytesReceivedDelta = (totalBytes - _lastBytesReceived) / elapsed;
          }
          _lastBytesReceived = totalBytes;
          _lastStatsTime = now;
          packetsLost = s.packetsLost ?? 0;
          packetsReceived = s.packetsReceived ?? 1;
        }
        // candidate-pair RTT
        if (s.type === "candidate-pair" && s.state === "succeeded" && !candidatePairFound) {
          rttMs = Math.round((s.currentRoundTripTime ?? 0) * 1000);
          candidatePairFound = true;
        }
      });

      // ===== 端到端延遲 / 帧间抖动 诊断 =====
      // 穩健版：只要偵測到 video 統計就每次輪詢都渲染 HUD（不再要求 framesDecoded 前進，
      // 因部分 iOS WKWebView 的 getStats 不提供逐帧計數器；缺的子指標顯示「—」）。
      if (vid) {
        const dFrames = (vid.framesDecoded ?? 0) - _prev.framesDecoded;
        const dJbDelay = (vid.jitterBufferDelay ?? 0) - _prev.jbDelay;
        const dJbCount = (vid.jitterBufferEmittedCount ?? 0) - _prev.jbCount;
        const dInter = (vid.totalInterFrameDelay ?? 0) - _prev.interFrame;
        const dInterSq = (vid.totalSquaredInterFrameDelay ?? 0) - _prev.interFrameSq;
        const dDecode = (vid.totalDecodeTime ?? 0) - _prev.decodeTime;
        const dFreezeCnt = (vid.freezeCount ?? 0) - _prev.freezeCount;
        const dFreezeDur = (vid.totalFreezesDuration ?? 0) - _prev.freezeDur;
        const dDropped = (vid.framesDropped ?? 0) - _prev.framesDropped;

        if (_prev.ready) {
          const fmt = (v: number | null, d = 0, suf = "") =>
            v === null || !isFinite(v) ? "—" : `${v.toFixed(d)}${suf}`;
          // 抖动缓冲平均延迟（ms）
          const jbMs = dJbCount > 0 ? (dJbDelay / dJbCount) * 1000 : null;
          // 平均解码耗时（ms）
          const decodeMs = dFrames > 0 ? (dDecode / dFrames) * 1000 : null;
          // 帧间间隔均值±标准差（ms）— 标准差大 = 节奏不稳（卡顿感来源）
          let meanIfMs: number | null = null, stdIfMs: number | null = null;
          if (dFrames > 0 && dInter > 0) {
            const meanIf = dInter / dFrames;
            const meanSq = dInterSq / dFrames;
            meanIfMs = meanIf * 1000;
            stdIfMs = Math.sqrt(Math.max(0, meanSq - meanIf * meanIf)) * 1000;
          }
          const jitterMs = vid.jitter != null ? vid.jitter * 1000 : null;
          const fps = vid.framesPerSecond ?? actualFps ?? 0;
          // 端到端延迟估算 = 单程网路(RTT/2) + 抖动缓冲 + 解码（缺项以 0 计）
          const e2eMs = rttMs / 2 + (jbMs ?? 0) + (decodeMs ?? 0);

          logDiag(
            `[DIAG] e2e≈${e2eMs.toFixed(0)}ms | RTT ${fmt(rttMs || null, 0, "ms")} | 抖动缓冲 ${fmt(jbMs, 0, "ms")} | ` +
            `解码 ${fmt(decodeMs, 1, "ms")} | 帧间 ${fmt(meanIfMs, 1)}±${fmt(stdIfMs, 1)}ms | ` +
            `jitter ${fmt(jitterMs, 1, "ms")} | fps ${fps.toFixed(1)} | ` +
            `卡顿 +${dFreezeCnt}(${(dFreezeDur * 1000).toFixed(0)}ms) | 丢帧 +${dDropped}`
          );
        }

        _prev.framesDecoded = vid.framesDecoded ?? 0;
        _prev.jbDelay = vid.jitterBufferDelay ?? 0;
        _prev.jbCount = vid.jitterBufferEmittedCount ?? 0;
        _prev.interFrame = vid.totalInterFrameDelay ?? 0;
        _prev.interFrameSq = vid.totalSquaredInterFrameDelay ?? 0;
        _prev.decodeTime = vid.totalDecodeTime ?? 0;
        _prev.freezeCount = vid.freezeCount ?? 0;
        _prev.freezeDur = vid.totalFreezesDuration ?? 0;
        _prev.framesDropped = vid.framesDropped ?? 0;
        _prev.ready = true;
      } else {
        // 沒有抓到 inbound-rtp video 統計：仍輸出一行，確認輪詢有在跑、並提示 RTT
        logDiag(`[DIAG] 等待視訊統計… | RTT ${rttMs || "—"}ms`);
      }

      // 更新實際 FPS
      const fpsEl = document.getElementById("val-metric-actual-fps");
      if (fpsEl) fpsEl.textContent = actualFps > 0 ? `${actualFps.toFixed(1)} fps` : "-- fps";

      // 更新實際位元率
      const bitrateEl = document.getElementById("val-metric-actual-bitrate");
      if (bitrateEl) {
        const mbps = bytesReceivedDelta * 8 / 1_000_000;
        bitrateEl.textContent = mbps > 0 ? `${mbps.toFixed(2)} Mbps` : "-- Mbps";
      }

      // 連線品質評分（綠 / 黃 / 紅）
      const lossRate = packetsReceived > 0 ? packetsLost / packetsReceived : 0;
      const indicator = document.getElementById("quality-indicator");
      const qualityLabel = document.getElementById("quality-label");
      
      // 動態注入適應性網路指標到畫面上方
      let floatingIndicator = document.getElementById("floating-network-indicator");
      if (!floatingIndicator) {
        floatingIndicator = document.createElement("div");
        floatingIndicator.id = "floating-network-indicator";
        floatingIndicator.style.position = "absolute";
        floatingIndicator.style.top = "16px";
        floatingIndicator.style.left = "50%";
        floatingIndicator.style.transform = "translateX(-50%)";
        floatingIndicator.style.width = "8px";
        floatingIndicator.style.height = "8px";
        floatingIndicator.style.borderRadius = "50%";
        floatingIndicator.style.zIndex = "1000";
        floatingIndicator.style.transition = "background-color 0.5s ease";
        floatingIndicator.style.boxShadow = "0 2px 6px rgba(0,0,0,0.5)";
        const videoContainer = document.getElementById("remote-video-container");
        if (videoContainer) videoContainer.appendChild(floatingIndicator);
      }

      let color = "#6b7280";
      if (indicator && qualityLabel) {
        if (rttMs <= 80 && lossRate < 0.01) {
          color = "#10b981"; // 綠 — 優
          qualityLabel.textContent = t("quality_excellent") || "Excellent";
        } else if (rttMs <= 200 && lossRate < 0.05) {
          color = "#f59e0b"; // 黃 — 可
          qualityLabel.textContent = t("quality_fair") || "Fair";
        } else {
          color = "#ef4444"; // 紅 — 差
          qualityLabel.textContent = t("quality_poor") || "Poor";
        }
        indicator.style.background = color;

        // 當網路狀態為紅 (極差) 時，啟動 AI 超解析 (前端銳化濾鏡)
        const remoteVideo = document.getElementById("remote-video") as HTMLVideoElement;
        if (remoteVideo) {
          if (color === "#ef4444") {
            remoteVideo.style.imageRendering = "pixelated"; // FSR-lite
            remoteVideo.style.filter = "contrast(1.1) brightness(1.05) saturate(1.2)";
          } else {
            remoteVideo.style.imageRendering = "auto";
            remoteVideo.style.filter = "none";
          }
        }
      }
      if (floatingIndicator) {
        floatingIndicator.style.backgroundColor = color;
      }
    } catch (e: any) {
      // 統計處理過程出錯：顯示到 HUD 以利定位（不再靜默吞掉）
      logDiag(`[DIAG] #${_diagTick} 統計處理錯誤: ${e?.message || e}`);
    }
  }, 2000);
}

// 初始化離線手動 SDP 連線控制（使用瀏覽器原生 WebRTC）
function initOfflineSdpMode() {
  const chkOffline = document.getElementById("chk-offline-sdp-mode") as HTMLInputElement;
  const sdpPanel = document.getElementById("offline-sdp-panel");
  const btnGenLocal = document.getElementById("btn-gen-local-sdp");
  const txtLocal = document.getElementById("txt-local-sdp") as HTMLTextAreaElement;
  const btnApplyRemote = document.getElementById("btn-apply-remote-sdp");
  const txtRemote = document.getElementById("txt-remote-sdp") as HTMLTextAreaElement;

  if (chkOffline && sdpPanel) {
    chkOffline.addEventListener("change", () => {
      sdpPanel.style.display = chkOffline.checked ? "flex" : "none";
    });
  }

  if (btnGenLocal && txtLocal) {
    btnGenLocal.addEventListener("click", async () => {
      try {
        // 用瀏覽器原生 RTCPeerConnection 產生 Offer SDP
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        peerConnection = pc;
        currentRemoteId = "manual";

        // 建立 Data Channels
        dataChannelControl = pc.createDataChannel("input-control", { ordered: true });
        bindControlChannel(dataChannelControl);
        
        dataChannelUnreliable = pc.createDataChannel("input-unreliable", { ordered: false, maxRetransmits: 0 });
        bindUnreliableChannel(dataChannelUnreliable);

        // 檔案傳輸 DataChannel
        dataChannelFileTransfer = pc.createDataChannel("file-transfer", { ordered: true });

        pc.onicecandidate = (event) => {
          if (!event.candidate) {
            // ICE 收集完畢，將完整 SDP 放入文字框
            const finalSdp = pc.localDescription?.sdp || "";
            txtLocal.value = finalSdp;
            txtLocal.select();
            navigator.clipboard.writeText(finalSdp).catch(() => {});
            alert(t("alert_sdp_success"));
          }
        };

        pc.onconnectionstatechange = () => updateConnectionStatusUI(pc.connectionState);
        pc.ondatachannel = (event) => {
          if (event.channel.label === "input-control") bindControlChannel(event.channel);
          if (event.channel.label === "input-unreliable") bindUnreliableChannel(event.channel);
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
      } catch (error) {
        alert(`${t("alert_sdp_fail")}${String(error)}`);
      }
    });
  }

  if (btnApplyRemote && txtRemote) {
    btnApplyRemote.addEventListener("click", async () => {
      const remoteSdpText = txtRemote.value.trim();
      if (!remoteSdpText) {
        alert(t("alert_sdp_empty"));
        return;
      }
      try {
        if (peerConnection && peerConnection.localDescription?.type === "offer") {
          await peerConnection.setRemoteDescription({ type: "answer", sdp: remoteSdpText });
          alert(t("alert_sdp_applied"));
        } else {
          // 被動端：套用遠端 Offer，自動產生並顯示 Answer
          const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
          peerConnection = pc;
          currentRemoteId = "manual";

          pc.onicecandidate = (event) => {
            if (!event.candidate) {
              const answerSdp = pc.localDescription?.sdp || "";
              txtLocal.value = answerSdp;
              txtLocal.select();
              navigator.clipboard.writeText(answerSdp).catch(() => {});
              alert(t("alert_answer_generated"));
            }
          };
          pc.onconnectionstatechange = () => updateConnectionStatusUI(pc.connectionState);
          pc.ondatachannel = (event) => {
            if (event.channel.label === "input-control") bindControlChannel(event.channel);
            if (event.channel.label === "input-unreliable") bindUnreliableChannel(event.channel);
          };

          await pc.setRemoteDescription({ type: "offer", sdp: remoteSdpText });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
        }
      } catch (error) {
        alert(`${t("alert_sdp_apply_fail")}${String(error)}`);
      }
    });
  }
}

// 初始化安全性與連線診斷功能
function initSystemDiagnostic() {
  const btnDiag = document.getElementById("btn-run-diagnostic");

  if (btnDiag) {
    btnDiag.addEventListener("click", async () => {
      const dnsVal = document.getElementById("val-diag-dns");
      const natVal = document.getElementById("val-diag-nat");
      
      if (dnsVal) dnsVal.textContent = t("diag_status_checking");
      if (natVal) natVal.textContent = t("diag_status_checking");
      
      if (!isDesktopTauri()) {
        alert(t("alert_web_diag_unsupported"));
        return;
      }
      
      try {
        const result = await invoke<any>("run_connection_diagnostic");
        lastDiagnosticResult = result;
        showDiagnosticResult();
      } catch (error) {
        const errorStr = String(error);
        const displayError = t(errorStr);
        alert(`${t("alert_diag_failed")}${displayError}`);
      }
    });
  }
}

// 初始化操作說明的點擊切換事件
function initHelpButtons() {
  const infoButtons = document.querySelectorAll(".btn-info");
  infoButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const helpId = btn.getAttribute("data-help");
      if (helpId) {
        const helpBlock = document.getElementById(`help-${helpId}`);
        if (helpBlock) {
          const isShown = helpBlock.classList.contains("show");
          // 關閉其他所有說明的顯示，保持介面簡潔
          document.querySelectorAll(".help-block").forEach((el) => {
            el.classList.remove("show");
          });
          
          if (!isShown) {
            helpBlock.classList.add("show");
          }
        }
      }
    });
  });

  // 點擊頁面其他任意地方時，自動收合說明欄位
  document.addEventListener("click", () => {
    document.querySelectorAll(".help-block").forEach((el) => {
      el.classList.remove("show");
    });
  });
}

// 初始化一鍵複製功能 (本機 ID / HWID / MAC) 並加上微交互回饋
function initClipboardCopy() {
  const btnCopyId = document.getElementById("btn-copy-id");
  const btnCopyHwid = document.getElementById("btn-copy-hwid");
  const btnCopyMac = document.getElementById("btn-copy-mac");
  const valMyId = document.getElementById("val-my-id");
  const valHwid = document.getElementById("val-hwid");
  const valMyMac = document.getElementById("val-my-mac");

  if (btnCopyId && valMyId) {
    btnCopyId.addEventListener("click", () => {
      const idText = valMyId.textContent || "";
      navigator.clipboard.writeText(idText).then(() => {
        btnCopyId.textContent = "✓";
        setTimeout(() => {
          btnCopyId.textContent = "📋";
        }, 1500);
      }).catch((err) => console.error("複製 ID 失敗:", err));
    });
  }
  
  if (btnCopyMac && valMyMac) {
    btnCopyMac.addEventListener("click", () => {
      const macText = valMyMac.textContent || "";
      navigator.clipboard.writeText(macText).then(() => {
        btnCopyMac.textContent = "✓";
        setTimeout(() => {
          btnCopyMac.textContent = "📋";
        }, 1500);
      }).catch((err) => console.error("複製 MAC 失敗:", err));
    });
  }

  if (btnCopyHwid && valHwid) {
    btnCopyHwid.addEventListener("click", () => {
      const hwidText = valHwid.textContent || "";
      navigator.clipboard.writeText(hwidText).then(() => {
        btnCopyHwid.textContent = "✓";
        setTimeout(() => {
          btnCopyHwid.textContent = "📋";
        }, 1500);
      }).catch((err) => console.error("複製 HWID 失敗:", err));
    });
  }
}

// 初始化智慧自動連線品質最佳化控制邏輯
function initSmartAutoMode() {
  const chkSmartAuto = document.getElementById("chk-smart-auto") as HTMLInputElement;
  const accordion = document.getElementById("simulator-accordion");
  const indicator = document.getElementById("auto-status-indicator");

  const rttInput = document.getElementById("range-rtt") as HTMLInputElement;
  const lossInput = document.getElementById("range-loss") as HTMLInputElement;
  const chkRelay = document.getElementById("chk-sim-relay") as HTMLInputElement;

  const rttVal = document.getElementById("val-sim-rtt");
  const lossVal = document.getElementById("val-sim-loss");

  if (!chkSmartAuto || !accordion || !indicator) return;

  const updateVisibility = () => {
    if (chkSmartAuto.checked) {
      accordion.classList.remove("accordion-expanded");
      accordion.classList.add("accordion-collapsed");
      indicator.style.display = "flex";
      
      // 智慧最佳化開啟時：重設模擬器參數為優質網路條件 (10ms, 0% 丟包, P2P 直連)
      if (rttInput) {
        rttInput.value = "10";
        if (rttVal) rttVal.textContent = "10 ms";
      }
      if (lossInput) {
        lossInput.value = "0";
        if (lossVal) lossVal.textContent = "0%";
      }
      if (chkRelay) {
        chkRelay.checked = false;
      }
      updateNetworkSimulation().catch((e) => console.error("同步最優網路狀態失敗:", e));
    } else {
      accordion.classList.remove("accordion-collapsed");
      accordion.classList.add("accordion-expanded");
      indicator.style.display = "none";
    }
  };

  chkSmartAuto.addEventListener("change", updateVisibility);
  
  // 根據 DOM 預設狀態進行初次同步
  updateVisibility();
}

// =========================================================================
// 檔案傳輸邏輯
// =========================================================================
let currentTransferTaskId: string | null = null;
let transferPollingInterval: number | null = null;

function initFileTransfer() {
  const dropZone = document.getElementById("file-drop-zone");
  const progressContainer = document.getElementById("transfer-progress-container");
  const filenameEl = document.getElementById("transfer-filename");
  const btnCancel = document.getElementById("btn-cancel-transfer");

  if (!dropZone) return;

  // 處理拖曳外觀
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--color-primary)";
    dropZone.style.background = "var(--color-primary-glow)";
  });
  
  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--panel-border)";
    dropZone.style.background = "rgba(0,0,0,0.02)";
  });

  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--panel-border)";
    dropZone.style.background = "rgba(0,0,0,0.02)";

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // PoC：目前只取第一個檔案
    const file = files[0];
    // Tauri 需要絕對路徑才能讀取，這邊為了 PoC 我們先假設可以從某些管道取得路徑
    // 實務上在 Tauri，如果開啟拖曳支援，event 中會有檔案路徑，或者可以使用 Tauri 的對話框
    // 這裡我們示範呼叫，實際路徑處理要看 Tauri plugin-fs 設定
    
    // 目前檔案傳輸功能尚未實裝，此區塊 UI 已隱藏
    console.warn("File transfer is not yet fully implemented.");
  });

  if (btnCancel) {
    btnCancel.addEventListener("click", async () => {
      // 檔案傳輸尚未實作，此按鈕已隨面板隱藏
      console.warn("Cancel transfer clicked, but feature is disabled.");
    });
  }
}

function startTransferPolling(taskId: string) {
  if (transferPollingInterval) clearInterval(transferPollingInterval);
  
  const pctEl = document.getElementById("transfer-pct");
  const barEl = document.getElementById("transfer-progress-bar");
  const progressContainer = document.getElementById("transfer-progress-container");

  transferPollingInterval = window.setInterval(async () => {
    if (!isDesktopTauri()) return;
    try {
      const tasks = await invoke<any[]>("get_active_transfers");
      const myTask = tasks.find(t => t.task_id === taskId);
      if (myTask) {
        const pct = Math.round(myTask.progress_pct);
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (barEl) barEl.style.width = `${pct}%`;
        
        if (myTask.status === "Completed") {
          clearInterval(transferPollingInterval!);
          setTimeout(() => {
            if (progressContainer) progressContainer.style.display = "none";
            alert("Transfer Complete!");
          }, 1000);
        } else if (myTask.status === "Cancelled" || myTask.status === "Failed") {
          clearInterval(transferPollingInterval!);
          if (progressContainer) progressContainer.style.display = "none";
        }
      } else {
        // 任務不見了（可能是被清理掉）
        clearInterval(transferPollingInterval!);
        if (progressContainer) progressContainer.style.display = "none";
      }
    } catch (e: any) {
      if (typeof e === 'string' && e.includes("not found")) return;
      console.error(e);
    }
  }, 1000);
}

// =========================================================================
// 遠端輸入控制 (滑鼠、觸控、鍵盤)
// =========================================================================

let controlSeqNumber = 0;
let unreliableSeqNumber = 0;
let inputBound = false;
let resetDisplayMode: () => void = () => {};

function buildInputPacket(eventType: number, payload: Uint8Array): Uint8Array {
  const isUnreliable = (eventType === 0x01 || eventType === 0x07);
  let seq = 0;
  if (isUnreliable) {
    unreliableSeqNumber++;
    seq = unreliableSeqNumber;
  } else {
    controlSeqNumber++;
    seq = controlSeqNumber;
  }
  const timestamp = Date.now();
  const packet = new Uint8Array(12 + 1 + payload.length);
  const view = new DataView(packet.buffer);
  
  view.setUint32(0, seq, false);
  view.setUint32(4, Math.floor(timestamp / 0x100000000), false);
  view.setUint32(8, timestamp % 0x100000000, false);
  
  packet[12] = eventType;
  packet.set(payload, 13);
  return packet;
}

function sendInputPacket(packet: Uint8Array) {
  const eventType = packet[12];
  if (eventType === 0x01 || eventType === 0x07) {
    if (dataChannelUnreliable && dataChannelUnreliable.readyState === "open") {
      dataChannelUnreliable.send(packet as any);
      return;
    }
  }
  if (dataChannelControl && dataChannelControl.readyState === "open") {
    dataChannelControl.send(packet as any);
  }
}

function pressKey(code: number, mods: number = 0) {
  const payload = new Uint8Array(3);
  const view = new DataView(payload.buffer);
  view.setUint16(0, code, false);
  payload[2] = mods;
  sendInputPacket(buildInputPacket(0x05, payload));
}

function releaseKey(code: number, mods: number = 0) {
  const payload = new Uint8Array(3);
  const view = new DataView(payload.buffer);
  view.setUint16(0, code, false);
  payload[2] = mods;
  sendInputPacket(buildInputPacket(0x06, payload));
}

function setupInputControl(videoEl: HTMLVideoElement) {
  // Quick Menu 已移除：連線成功時保持隱藏，不要覆寫 HTML 的 display:none !important
  const mobileControlOrb = document.getElementById("mobile-control-orb");
  if (mobileControlOrb) {
    mobileControlOrb.style.display = "none";
  }

  // 顯示可收合的連線工具列（模式切換 / 顯示大小 / 登出）
  const sessionToolbar = document.getElementById("session-toolbar");
  if (sessionToolbar) {
    sessionToolbar.style.display = "flex";
  }
  // 工具列把手：展開/收合動作列
  const toolbarToggle = document.getElementById("btn-toolbar-toggle");
  const toolbarActions = document.getElementById("toolbar-actions");
  if (toolbarToggle && toolbarActions && !toolbarToggle.dataset.bound) {
    toolbarToggle.dataset.bound = "1";
    toolbarToggle.onclick = (e) => {
      e.stopPropagation();
      const open = toolbarActions.style.display !== "none";
      toolbarActions.style.display = open ? "none" : "flex";
      toolbarToggle.textContent = open ? "⚙️" : "✕";
    };
  }

  // 同步更新 Touch Mode 按鈕文字以符合當前的 isDirectTouchMode 狀態
  const btnTouchMode = document.getElementById("btn-touch-mode") as HTMLButtonElement;
  if (btnTouchMode) {
    if (isDirectTouchMode) {
      btnTouchMode.textContent = "👆 Direct Touch";
    } else {
      btnTouchMode.textContent = "🖱️ Trackpad Mode";
    }
  }

  if (inputBound) return;
  inputBound = true;

  // --- 畫質與自適應調適狀態 ---


  // --- 邊緣平移與顯示模式狀態 ---
  let displayMode: "fit" | "original" | "fill" = "fit";
  let panRafId: number | null = null;
  currentCursorPercentX = 0.5;
  currentCursorPercentY = 0.5;
  let remoteCursor = document.getElementById("remote-cursor-indicator");
  if (!remoteCursor) {
    remoteCursor = document.createElement("div");
    remoteCursor.id = "remote-cursor-indicator";
    // position:fixed 確保座標對齊視口，不受 pan/transform 影響
    remoteCursor.style.position = "fixed";
    const _mobile = !isDesktopTauri();
    remoteCursor.style.width = _mobile ? "24px" : "16px";
    remoteCursor.style.height = _mobile ? "30px" : "20px";
    remoteCursor.style.borderRadius = "0px";
    remoteCursor.style.backgroundColor = "transparent";
    const svgW = _mobile ? 24 : 16;
    const svgH = _mobile ? 30 : 20;
    remoteCursor.style.backgroundImage = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='${svgW}' height='${svgH}'><path d='M0,0 L0,17 L4.7,12.3 L8,20 L10.5,19 L7.2,11.3 L12.7,11.3 Z' fill='white' stroke='black' stroke-width='1.5' stroke-linejoin='miter'/></svg>")`;
    remoteCursor.style.backgroundSize = "contain";
    remoteCursor.style.backgroundRepeat = "no-repeat";
    remoteCursor.style.boxShadow = "none";
    remoteCursor.style.pointerEvents = "none";
    remoteCursor.style.zIndex = "1001";
    remoteCursor.style.display = "none";
    remoteCursor.style.transform = "none";
    document.body.appendChild(remoteCursor);
  }
  let lastMouseClientX = window.innerWidth / 2;
  let lastMouseClientY = window.innerHeight / 2;
  let hasMouseMoved = false;
  let isMouseInsideVideo = false;

  const videoContainer = document.getElementById("remote-video-container") as HTMLElement;
  const btnDisplayMode = document.getElementById("btn-display-mode") as HTMLButtonElement;
  const keyboardBar = document.getElementById("mobile-keyboard-bar") as HTMLDivElement;
  const mobileKeyboardInput = document.getElementById("mobile-keyboard-input") as HTMLInputElement;
  const btnKeyboardSend = document.getElementById("btn-mobile-keyboard-send") as HTMLButtonElement;
  let isKeyboardActive = false;
  let openMobileKeyboard: (() => void) | null = null;
  // 釋放所有被按住的桌面修飾鍵（⌘⌃⌥⇧），供關閉鍵盤/失焦/斷線等路徑呼叫，避免修飾鍵卡死
  let releaseAllHeldMods: (() => void) | null = null;
  // 觸發鍵盤的那一下點擊在螢幕上的 Y 座標（client px）；鍵盤彈出時據此把畫面上移到剛好露出焦點
  let kbFocusClientY = -1;
  let lastBackspaceTime = 0;
  let isComposing = false;
  let lastValue = ""; // 用於追蹤鍵盤增量輸入框內容

  // 智慧型滑鼠磁吸吸附定位演算法
  function applySmartSnapping(x: number, y: number, speed: number): { x: number, y: number } {
    if (speed > 0.008) {
      return { x, y };
    }
    let snappedX = x;
    let snappedY = y;
    
    // 1. macOS 頂部選單列磁吸 (Y = 0% 至 3.5%)
    if (y > 0 && y < 0.035) {
      snappedY = 0.016; // 鎖定在選單列垂直中線
      
      // 2. 蘋果選單  (X = 0% 至 3%)
      if (x > 0 && x < 0.03) {
        snappedX = 0.015;
      }
    }
    
    // 3. macOS 底部 Dock 欄磁吸 (Y = 96% 至 100%)
    if (y > 0.96 && y <= 1.0) {
      snappedY = 0.978; // 鎖定在 Dock 欄垂直中線
    }
    
    return { x: snappedX, y: snappedY };
  }

  // 顯示模式切換處理
  function applyDisplayMode() {
    if (!videoEl || !videoContainer) return;
    
    if (displayMode === "fit") {
      if (btnDisplayMode) btnDisplayMode.textContent = "🔍 " + t("btn_original_size");
      videoEl.style.objectFit = "contain";
      videoEl.style.width = "100%";
      videoEl.style.height = "100%";
      // 重置 Pinch 放大相關的 transform 狀態，回歸適應視窗
      videoScale = 1.0;
      videoTranslateX = 0;
      videoTranslateY = 0;
      keyboardOffsetUpdateY = 0;
      applyVideoTransform();
    } else if (displayMode === "original") {
      if (btnDisplayMode) btnDisplayMode.textContent = "🔍 " + t("btn_aspect_fill");
      videoEl.style.objectFit = "none";
      videoEl.style.width = videoEl.videoWidth + "px";
      videoEl.style.height = videoEl.videoHeight + "px";
      videoContainer.style.overflow = "hidden";
      videoScale = 1.0;
      videoTranslateX = 0;
      videoTranslateY = 0;
      keyboardOffsetUpdateY = 0;
      applyVideoTransform();
    } else if (displayMode === "fill") {
      if (btnDisplayMode) btnDisplayMode.textContent = "🔍 " + t("btn_scale_to_fit");
      videoEl.style.objectFit = "contain";
      videoEl.style.width = "100%";
      videoEl.style.height = "100%";
      videoContainer.style.overflow = "hidden";
      
      const containerWidth = videoContainer.clientWidth || window.innerWidth;
      const containerHeight = videoContainer.clientHeight || window.innerHeight;
      const videoWidth = videoEl.videoWidth || 1920;
      const videoHeight = videoEl.videoHeight || 1080;
      
      const containerRatio = containerWidth / containerHeight;
      const videoRatio = videoWidth / videoHeight;
      
      let baseFillScale = 1.0;
      if (containerRatio > videoRatio) {
        baseFillScale = containerRatio / videoRatio;
      } else {
        baseFillScale = videoRatio / containerRatio;
      }
      
      videoScale = baseFillScale;
      videoTranslateX = 0;
      videoTranslateY = 0;
      keyboardOffsetUpdateY = 0;
      applyVideoTransform();
    }
  }

  const cycleDisplayMode = () => {
    if (displayMode === "fit") {
      displayMode = "original";
    } else if (displayMode === "original") {
      displayMode = "fill";
    } else {
      displayMode = "fit";
    }
    applyDisplayMode();
  };

  if (btnDisplayMode) {
    btnDisplayMode.textContent = "🔍 " + t("btn_original_size");
    btnDisplayMode.onclick = cycleDisplayMode;
  }

  // --- 取代 Quick Menu 的獨立浮動控制鈕 ---
  const btnDisplayModeFloat = document.getElementById("btn-display-mode-float") as HTMLButtonElement;
  if (btnDisplayModeFloat) {
    btnDisplayModeFloat.textContent = btnDisplayMode ? btnDisplayMode.textContent : "🔍 " + t("btn_original_size");
    btnDisplayModeFloat.onclick = () => {
      cycleDisplayMode();
      // applyDisplayMode 只會更新 btnDisplayMode 的文字，這裡同步浮動鈕
      if (btnDisplayMode) btnDisplayModeFloat.textContent = btnDisplayMode.textContent;
    };
  }

  const btnTouchModeFloat = document.getElementById("btn-touch-mode-float") as HTMLButtonElement;
  const syncTouchModeLabel = () => {
    if (btnTouchModeFloat) {
      btnTouchModeFloat.textContent = isDirectTouchMode ? "👆 Direct Touch" : "🖱️ Trackpad";
    }
  };
  if (btnTouchModeFloat) {
    syncTouchModeLabel();
    btnTouchModeFloat.onclick = () => {
      isDirectTouchMode = !isDirectTouchMode;
      console.log("[FloatControls] Touch mode toggled, isDirectTouchMode:", isDirectTouchMode);
      syncTouchModeLabel();
      // 同步舊 Quick Menu 內按鈕文字（雖已隱藏，保持狀態一致）
      const orbBtn = document.getElementById("btn-touch-mode");
      if (orbBtn) orbBtn.textContent = isDirectTouchMode ? "👆 Direct Touch" : "🖱️ Trackpad Mode";
      // 切到直控模式時隱藏合成游標；切到軌跡板模式則於下次移動時重新顯示
      if (isDirectTouchMode) {
        const rc = document.getElementById("remote-cursor-indicator");
        if (rc) rc.style.display = "none";
      }
    };
  }

  const btnAudioToggle = document.getElementById("btn-audio-toggle") as HTMLButtonElement;
  if (btnAudioToggle) {
    btnAudioToggle.onclick = () => {
      const audioEl = document.getElementById("remote-audio") as HTMLAudioElement;
      if (audioEl) {
        audioEl.muted = !audioEl.muted;
        btnAudioToggle.textContent = audioEl.muted ? "🔇 Unmute" : "🔊 Mute";
      }
    };
  }

  const btnSwitchMonitor = document.getElementById("btn-switch-monitor") as HTMLButtonElement;
  if (btnSwitchMonitor) {
    btnSwitchMonitor.onclick = () => {
      if (availableMonitors.length > 1 && dataChannelSystemControl && dataChannelSystemControl.readyState === "open") {
        currentMonitorIndex = (currentMonitorIndex + 1) % availableMonitors.length;
        btnSwitchMonitor.textContent = `🖥️ ${availableMonitors[currentMonitorIndex].name}`;
        
        dataChannelSystemControl.send(JSON.stringify({
          type: "switch_monitor",
          index: currentMonitorIndex
        }));
      }
    };
  }

  function startEdgePanLoop() {
    if (panRafId !== null) return;
    panRafId = 1; // 標記已啟動（改用幀對齊排程，不再保存 rAF id）
    // 幀對齊排程：優先 requestVideoFrameCallback（與解碼影格同步，平移與內容不撕裂、速度跟著實際幀率），
    // 不支援時回退 requestAnimationFrame。
    const scheduleVideoFrame = (cb: (ts: number) => void) => {
      const anyVideo = videoEl as any;
      if (typeof anyVideo.requestVideoFrameCallback === "function") {
        anyVideo.requestVideoFrameCallback((now: number) => cb(now));
      } else {
        requestAnimationFrame((now) => cb(now));
      }
    };
    let lastPanTs = 0;
    const loop = (ts: number) => {
      if (!videoContainer) { scheduleVideoFrame(loop); return; }
      if (!isMouseInsideVideo || !hasMouseMoved) {
        lastPanTs = 0; // 閒置時重置，避免下次 dt 過大造成跳動
        scheduleVideoFrame(loop);
        return;
      }
      // 以實際影格間隔正規化平移速度，與幀率無關（30/60fps 行為一致）
      const dtPan = lastPanTs ? Math.min((ts - lastPanTs) / 1000, 0.05) : 1 / 60;
      lastPanTs = ts;

      const rect = videoEl.getBoundingClientRect();
      const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
      const containerRatio = rect.width / rect.height;
      let renderedWidth: number, renderedHeight: number, offsetX = 0, offsetY = 0;
      if (containerRatio > videoRatio) {
        renderedHeight = rect.height;
        renderedWidth = renderedHeight * videoRatio;
        offsetX = (rect.width - renderedWidth) / 2;
      } else {
        renderedWidth = rect.width;
        renderedHeight = renderedWidth / videoRatio;
        offsetY = (rect.height - renderedHeight) / 2;
      }
      
      let pixelX = 0, pixelY = 0;
      if (document.pointerLockElement === videoEl) {
        pixelX = rect.left + offsetX + syntheticCursorPercentX * renderedWidth;
        pixelY = rect.top + offsetY + syntheticCursorPercentY * renderedHeight;
      } else if (!isDirectTouchMode) {
        // Trackpad 模式：手指位置 ≠ 游標位置，改用合成游標(trackpadCursor)的螢幕座標來判定邊緣，
        // 與 updateCursorOverlay 同一套 rect/百分比換算，確保游標貼齊視覺位置。
        pixelX = rect.left + offsetX + trackpadCursorX * renderedWidth;
        pixelY = rect.top + offsetY + trackpadCursorY * renderedHeight;
      } else {
        pixelX = lastMouseClientX;
        pixelY = lastMouseClientY;
      }

      const edgeThresholdX = window.innerWidth * 0.08;
      const edgeThresholdY = window.innerHeight * 0.08;
      const panSpeed = 700 * dtPan; // 時間正規化平移量（≈700 px/秒，與幀率無關）
      
      let dx = 0;
      let dy = 0;
      
      if (pixelX < edgeThresholdX) {
        dx = -panSpeed;
      } else if (pixelX > window.innerWidth - edgeThresholdX) {
        dx = panSpeed;
      }
      
      if (pixelY < edgeThresholdY) {
        dy = -panSpeed;
      } else if (pixelY > window.innerHeight - edgeThresholdY) {
        dy = panSpeed;
      }
      
      if (dx !== 0 || dy !== 0) {
        if (displayMode === "original") {
          // 模式一：物理大小模式，平移 container 滾動條
          videoContainer.scrollLeft += dx;
          videoContainer.scrollTop += dy;
        } else if (videoScale > 1.0) {
          // 模式二：Scale 放大模式，平移 CSS transform
          const containerWidth = videoContainer.clientWidth;
          const containerHeight = videoContainer.clientHeight;
          const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
          const containerRatio = containerWidth / containerHeight;
          
          let renderedWidth = containerWidth;
          let renderedHeight = containerHeight;
          if (containerRatio > videoRatio) {
            renderedHeight = containerHeight;
            renderedWidth = renderedHeight * videoRatio;
          } else {
            renderedWidth = containerWidth;
            renderedHeight = renderedWidth / videoRatio;
          }
          
          const maxTx = (renderedWidth * videoScale >= containerWidth) ? (renderedWidth * videoScale - containerWidth) / 2 : 0;
          const maxTy = (renderedHeight * videoScale >= containerHeight) ? (renderedHeight * videoScale - containerHeight) / 2 : 0;
          
          // 畫面往反方向帶：dx > 0 (游標在右側) -> 視訊向左移 (videoTranslateX 減少)
          videoTranslateX -= dx;
          videoTranslateY -= dy;
          
          videoTranslateX = Math.max(-maxTx, Math.min(maxTx, videoTranslateX));
          videoTranslateY = Math.max(-maxTy, Math.min(maxTy, videoTranslateY));
          applyVideoTransform();
        }

        // 畫面平移後的游標/座標處理
        if (document.pointerLockElement === videoEl) {
          // Pointer Lock：合成游標由 pointermove 維護，這裡不需處理
        } else if (!isDirectTouchMode) {
          // Trackpad 模式：平移只是本地視覺，遠端座標仍是 trackpadCursor（未改變），
          // 不可用手指位置重算。只需依新的 transform 重畫合成游標，使其跟著內容。
          updateCursorOverlay(trackpadCursorX, trackpadCursorY);
        } else {
          // 直控/實體滑鼠：手指(滑鼠)位置 == 游標位置，重算遠端絕對百分比並發送
          let updatedX = 0, updatedY = 0;
          if (displayMode === "original" && videoContainer) {
            const rectContainer = videoContainer.getBoundingClientRect();
            updatedX = (lastMouseClientX - rectContainer.left + videoContainer.scrollLeft) / videoEl.videoWidth;
            updatedY = (lastMouseClientY - rectContainer.top + videoContainer.scrollTop) / videoEl.videoHeight;
          } else {
            const rectNew = videoEl.getBoundingClientRect();
            const videoRatioNew = videoEl.videoWidth / videoEl.videoHeight;
            const containerRatioNew = rectNew.width / rectNew.height;
            
            let renderedWidthNew, renderedHeightNew, offsetXNew = 0, offsetYNew = 0;
            if (containerRatioNew > videoRatioNew) {
              renderedHeightNew = rectNew.height;
              renderedWidthNew = renderedHeightNew * videoRatioNew;
              offsetXNew = (rectNew.width - renderedWidthNew) / 2;
            } else {
              renderedWidthNew = rectNew.width;
              renderedHeightNew = renderedWidthNew / videoRatioNew;
              offsetYNew = (rectNew.height - renderedHeightNew) / 2;
            }
            
            updatedX = (lastMouseClientX - rectNew.left - offsetXNew) / renderedWidthNew;
            updatedY = (lastMouseClientY - rectNew.top - offsetYNew) / renderedHeightNew;
          }
          
          updatedX = Math.max(0, Math.min(1, updatedX));
          updatedY = Math.max(0, Math.min(1, updatedY));
          
          pendingMouseMoveX = updatedX;
          pendingMouseMoveY = updatedY;
          triggerMoveRaf();

          currentCursorPercentX = updatedX;
          currentCursorPercentY = updatedY;
        }
      }
      
      scheduleVideoFrame(loop);
    };
    scheduleVideoFrame(loop);
  }

  // 啟動全時邊緣平移檢測
  startEdgePanLoop();

  // --- 速率限制 (Rate Limiting) 與 60Hz 節流機制 ---
  let pendingMouseMoveX: number | null = null;
  let pendingMouseMoveY: number | null = null;
  let pendingRelativeDX = 0;
  let pendingRelativeDY = 0;
  let moveRafActive = false;

  function triggerMoveRaf() {
    if (!moveRafActive) {
      moveRafActive = true;
      requestAnimationFrame(() => {
        sendPendingMoves();
        moveRafActive = false;
      });
    }
  }

  function sendPendingMoves() {
    
    // 優先發送相對位移 (Pointer Lock 模式)
    if (pendingRelativeDX !== 0 || pendingRelativeDY !== 0) {
      const payload = new Uint8Array(8);
      const view = new DataView(payload.buffer);
      view.setInt32(0, pendingRelativeDX, false);
      view.setInt32(4, pendingRelativeDY, false);
      sendInputPacket(buildInputPacket(0x07, payload));
      
      pendingRelativeDX = 0;
      pendingRelativeDY = 0;
    }
    
    // 發送絕對座標
    if (pendingMouseMoveX !== null && pendingMouseMoveY !== null) {
      const payload = new Uint8Array(8);
      const view = new DataView(payload.buffer);
      view.setFloat32(0, pendingMouseMoveX, false);
      view.setFloat32(4, pendingMouseMoveY, false);
      sendInputPacket(buildInputPacket(0x01, payload));
      
      pendingMouseMoveX = null;
      pendingMouseMoveY = null;
    }
  }

  // --- 觸控與手勢引擎狀態 ---
  let trackpadCursorX = 0.5;
  let trackpadCursorY = 0.5;
  let touchStartTime = 0;
  let lastTapTime = 0;
  let lastTapPos = { x: 0, y: 0 };
  let isDragging = false;
  let isPotentialDrag = false;
  let twoFingerHasMoved = false;
  let wasLongPressDrag = false;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchStartPos = { x: 0, y: 0 };

  const sendDoubleClickSequence = () => {
    triggerHaptic("medium");
    const payloadDown = new Uint8Array(1);
    payloadDown[0] = 1; // Left click down
    sendInputPacket(buildInputPacket(0x02, payloadDown));
    
    setTimeout(() => {
      const payloadUp = new Uint8Array(1);
      payloadUp[0] = 1; // Left click up
      sendInputPacket(buildInputPacket(0x03, payloadUp));
      
      setTimeout(() => {
        const payloadDown2 = new Uint8Array(1);
        payloadDown2[0] = 1; // Left click down
        sendInputPacket(buildInputPacket(0x02, payloadDown2));
        
        setTimeout(() => {
          const payloadUp2 = new Uint8Array(1);
          payloadUp2[0] = 1; // Left click up
          sendInputPacket(buildInputPacket(0x03, payloadUp2));
          console.log("[Gesture] 智慧雙擊序列發送完成");
        }, 60);
      }, 60);
    }, 60);
  };



  const triggerMacShortcut = (shortcut: "mission-control" | "space-left" | "space-right") => {
    const ctrlCode = 17;
    let arrowCode = 38; // Up for Mission Control
    if (shortcut === "space-left") {
      arrowCode = 37; // Left arrow
    } else if (shortcut === "space-right") {
      arrowCode = 39; // Right arrow
    }

    // Press Ctrl, then press Arrow, then release Arrow, then release Ctrl
    pressKey(ctrlCode, 2);
    pressKey(arrowCode, 2);
    setTimeout(() => {
      releaseKey(arrowCode, 2);
      releaseKey(ctrlCode, 0);
    }, 50);
  };
  let initialPinchDistance = -1;
  let maxTouches = 0;
  let isLocalPinching = false;
  let isThreeFingerGesture = false;
  let threeFingerStartPos = { x: 0, y: 0 };
  let threeFingerHasMoved = false;

  let pinchStartScale = 1.0;
  let pinchStartTx = 0;
  let pinchStartTy = 0;
  let pinchStartCx = 0;
  let pinchStartCy = 0;

  // 觸控模式 (絕對觸控 vs 虛擬軌跡板)
  isDirectTouchMode = false; // 預設為軌跡板模式
  let longPressTimer: any = null;
  let touchStartClientX = 0;
  let touchStartClientY = 0;
  let hasTriggeredLongPress = false;

  // --- 多指轉換防護 (Gesture Transition Guard) ---
  // 確保單指 / 雙指 / 三指手勢彼此獨立，減少控制誤判。
  // 當手指數由 1 增加到 2 或 3 時，若單指長按/拖曳仍持有滑鼠左鍵，
  // 先釋放左鍵並清除單指狀態，避免「左鍵卡住」污染後續的雙指捲動/捏合或三指手勢。
  const releaseSingleFingerDragIfActive = () => {
    if (isDragging || hasTriggeredLongPress) {
      const payload = new Uint8Array(1);
      payload[0] = 1; // Left button up
      sendInputPacket(buildInputPacket(0x03, payload));
      console.log("[Gesture] 多指轉換：釋放單指拖曳殘留的左鍵，避免誤判");
    }
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    isDragging = false;
    isPotentialDrag = false;
    hasTriggeredLongPress = false;
    wasLongPressDrag = false;
  };

  // --- 慣性 (Momentum) 狀態 ---
  let momentumVx = 0;
  let momentumVy = 0;
  let momentumRafId: number | null = null;
  const MOMENTUM_DECAY = 0.92;
  const MOMENTUM_MIN_VELOCITY = 0.0005;
  let lastMoveTimestamp = 0;

  function startMomentum() {
    if (momentumRafId !== null) return;
    const step = () => {
      if (Math.abs(momentumVx) < MOMENTUM_MIN_VELOCITY && Math.abs(momentumVy) < MOMENTUM_MIN_VELOCITY) {
        momentumRafId = null;
        return;
      }
      trackpadCursorX += momentumVx;
      trackpadCursorY += momentumVy;
      trackpadCursorX = Math.max(0, Math.min(1, trackpadCursorX));
      trackpadCursorY = Math.max(0, Math.min(1, trackpadCursorY));
      pendingMouseMoveX = trackpadCursorX;
      pendingMouseMoveY = trackpadCursorY;
      triggerMoveRaf();
      updateCursorOverlay(trackpadCursorX, trackpadCursorY);
      currentCursorPercentX = trackpadCursorX;
      currentCursorPercentY = trackpadCursorY;
      momentumVx *= MOMENTUM_DECAY;
      momentumVy *= MOMENTUM_DECAY;
      momentumRafId = requestAnimationFrame(step);
    };
    momentumRafId = requestAnimationFrame(step);
  }

  function stopMomentum() {
    if (momentumRafId !== null) {
      cancelAnimationFrame(momentumRafId);
      momentumRafId = null;
    }
    momentumVx = 0;
    momentumVy = 0;
  }

  let scrollVx = 0;
  let scrollVy = 0;
  let lastScrollTimestamp = 0;
  let scrollMomentumRafId: number | null = null;
  const SCROLL_DECAY = 0.95;
  const SCROLL_MIN_VELOCITY = 0.1;

  function startScrollMomentum() {
    if (scrollMomentumRafId !== null) return;
    const loop = () => {
      if (Math.abs(scrollVx) < SCROLL_MIN_VELOCITY && Math.abs(scrollVy) < SCROLL_MIN_VELOCITY) {
        scrollMomentumRafId = null;
        return;
      }
      
      const dx = Math.round(scrollVx);
      const dy = Math.round(scrollVy);
      
      if (dx !== 0 || dy !== 0) {
        const payload = new Uint8Array(4);
        const view = new DataView(payload.buffer);
        view.setInt16(0, dx, false);
        view.setInt16(2, dy, false);
        sendInputPacket(buildInputPacket(0x04, payload));
      }
      
      scrollVx *= SCROLL_DECAY;
      scrollVy *= SCROLL_DECAY;
      
      scrollMomentumRafId = requestAnimationFrame(loop);
    };
    scrollMomentumRafId = requestAnimationFrame(loop);
  }

  function stopScrollMomentum() {
    if (scrollMomentumRafId !== null) {
      cancelAnimationFrame(scrollMomentumRafId);
      scrollMomentumRafId = null;
    }
    scrollVx = 0;
    scrollVy = 0;
  }

  function applyAcceleration(delta: number): number {
    const absDelta = Math.abs(delta);
    let multiplier: number;
    if (absDelta < 3) {
      multiplier = 1.0;                                   // 小幅移動 1:1，精準不漂移
    } else if (absDelta < 12) {
      multiplier = 1.0 + ((absDelta - 3) / 9) * 0.8;      // 1.0 → 1.8 緩升
    } else {
      multiplier = Math.min(1.8 + (absDelta - 12) * 0.03, 2.6); // 封頂 2.6，避免快速滑動暴衝
    }
    return delta * multiplier;
  }

  function updateCursorOverlay(percentX: number, percentY: number) {
    let remoteCursor = document.getElementById("remote-cursor-indicator");
    // 被控端已合成真實游標於影像中，前端不再顯示合成游標（零偏移、避免雙游標）
    if (HOST_RENDERS_CURSOR) {
      if (remoteCursor) remoteCursor.style.display = "none";
      return;
    }
    const rect = videoEl.getBoundingClientRect();
    const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
    const containerRatio = rect.width / rect.height;
    let renderedWidth: number, renderedHeight: number, offsetX = 0, offsetY = 0;
    if (containerRatio > videoRatio) {
      renderedHeight = rect.height;
      renderedWidth = renderedHeight * videoRatio;
      offsetX = (rect.width - renderedWidth) / 2;
    } else {
      renderedWidth = rect.width;
      renderedHeight = renderedWidth / videoRatio;
      offsetY = (rect.height - renderedHeight) / 2;
    }
    const pixelX = rect.left + offsetX + percentX * renderedWidth;
    const pixelY = rect.top + offsetY + percentY * renderedHeight;
    
    if (remoteCursor) {
      remoteCursor.style.display = "block";
      remoteCursor.style.left = `${pixelX}px`;
      remoteCursor.style.top = `${pixelY}px`;
    }
  }



  function getPinchDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // --- 滑鼠事件對應 (Pointer Lock 模式) ---
  let syntheticCursorPercentX = 0.5;
  let syntheticCursorPercentY = 0.5;

  videoEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") return;
    e.preventDefault();
    videoContainer?.focus();
    if (!isDirectTouchMode && document.pointerLockElement !== videoEl) {
      videoEl.requestPointerLock().catch(() => {});
    }
    const payload = new Uint8Array(1);
    if (e.button === 0) payload[0] = 1;
    else if (e.button === 2) payload[0] = 2;
    else if (e.button === 1) payload[0] = 3;
    else return;
    sendInputPacket(buildInputPacket(0x02, payload));
  });

  videoEl.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") return;
    e.preventDefault();
    const payload = new Uint8Array(1);
    if (e.button === 0) payload[0] = 1;
    else if (e.button === 2) payload[0] = 2;
    else if (e.button === 1) payload[0] = 3;
    else return;
    sendInputPacket(buildInputPacket(0x03, payload));
  });

  videoEl.addEventListener("pointermove", (e) => {
    e.preventDefault();
    if (e.pointerType === "touch" || e.pointerType === "pen") return; // 由觸控手勢處理
    
    lastMouseClientX = e.clientX;
    lastMouseClientY = e.clientY;
    hasMouseMoved = true;
    isMouseInsideVideo = true;
    
    if (document.pointerLockElement === videoEl) {
      pendingRelativeDX += Math.round(e.movementX);
      pendingRelativeDY += Math.round(e.movementY);
      triggerMoveRaf();
      
      const rect = videoEl.getBoundingClientRect();
      const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
      const containerRatio = rect.width / rect.height;
      
      let renderedWidth, renderedHeight;
      if (containerRatio > videoRatio) {
        renderedHeight = rect.height;
        renderedWidth = renderedHeight * videoRatio;
      } else {
        renderedWidth = rect.width;
        renderedHeight = renderedWidth / videoRatio;
      }

      // 在鎖定模式下，根據實際滑鼠的移動量累積計算本地合成游標的絕對位置
      syntheticCursorPercentX += e.movementX / (renderedWidth || 1);
      syntheticCursorPercentY += e.movementY / (renderedHeight || 1);
      
      // 確保游標不會超出畫面範圍
      syntheticCursorPercentX = Math.max(0, Math.min(1, syntheticCursorPercentX));
      syntheticCursorPercentY = Math.max(0, Math.min(1, syntheticCursorPercentY));
      
      currentCursorPercentX = syntheticCursorPercentX;
      currentCursorPercentY = syntheticCursorPercentY;
      
      updateCursorOverlay(syntheticCursorPercentX, syntheticCursorPercentY);
    } else {
      let x = 0, y = 0;
      if (displayMode === "original" && videoContainer) {
        x = (e.clientX + videoContainer.scrollLeft) / videoEl.videoWidth;
        y = (e.clientY + videoContainer.scrollTop) / videoEl.videoHeight;
      } else {
        const rect = videoEl.getBoundingClientRect();
        const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
        const containerRatio = rect.width / rect.height;
        
        let renderedWidth, renderedHeight, offsetX = 0, offsetY = 0;
        if (containerRatio > videoRatio) {
          renderedHeight = rect.height;
          renderedWidth = renderedHeight * videoRatio;
          offsetX = (rect.width - renderedWidth) / 2;
        } else {
          renderedWidth = rect.width;
          renderedHeight = renderedWidth / videoRatio;
          offsetY = (rect.height - renderedHeight) / 2;
        }
 
        x = (e.clientX - rect.left - offsetX) / renderedWidth;
        y = (e.clientY - rect.top - offsetY) / renderedHeight;
      }

      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
      
      // 移除智能磁吸，提供完全原生的絕對座標映射
      
      pendingMouseMoveX = x;
      pendingMouseMoveY = y;
      triggerMoveRaf();

      // 在軌跡板模式下，滑鼠移動時同步更新本地游標位置
      if (!isDirectTouchMode) {
        trackpadCursorX = x;
        trackpadCursorY = y;
      }

      currentCursorPercentX = x;
      currentCursorPercentY = y;
      // 實體滑鼠不再更新與顯示合成游標，直接依賴原生游標
    }
  });

  videoEl.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") return;
    isMouseInsideVideo = false;
    currentCursorPercentX = 0.5;
    currentCursorPercentY = 0.5;
  });

  videoEl.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") return;
    isMouseInsideVideo = true;
  });

  // --- 手勢辨識與狀態機 ---
  videoEl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    maxTouches = Math.max(maxTouches, e.touches.length);
    stopMomentum();
    stopScrollMomentum();
    
    if (e.touches.length === 3) {
      // 1/2 → 3 指轉換：先釋放單指拖曳殘留按鍵，確保三指手勢獨立
      releaseSingleFingerDragIfActive();
      isThreeFingerGesture = true;
      threeFingerHasMoved = false;
      const avgX = (e.touches[0].clientX + e.touches[1].clientX + e.touches[2].clientX) / 3;
      const avgY = (e.touches[0].clientY + e.touches[1].clientY + e.touches[2].clientY) / 3;
      threeFingerStartPos = { x: avgX, y: avgY };
      touchStartTime = Date.now();
    } else if (e.touches.length === 2) {
      // 1 → 2 指轉換：先釋放單指拖曳殘留按鍵，避免左鍵卡住污染雙指捲動/捏合
      releaseSingleFingerDragIfActive();
      initialPinchDistance = getPinchDistance(e.touches);
      lastTouchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastTouchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      touchStartTime = Date.now();
      touchStartPos = { x: lastTouchX, y: lastTouchY };
      isLocalPinching = false;
      pinchStartScale = videoScale;
      pinchStartTx = videoTranslateX;
      pinchStartTy = videoTranslateY;
      pinchStartCx = lastTouchX;
      pinchStartCy = lastTouchY;
      twoFingerHasMoved = false; // 重置雙指移動狀態
    } else if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      const now = Date.now();
      
      touchStartTime = now;
      touchStartPos = { x: lastTouchX, y: lastTouchY };
      touchStartClientX = lastTouchX;
      touchStartClientY = lastTouchY;
      hasTriggeredLongPress = false;
      isPotentialDrag = false;
      wasLongPressDrag = false;

      if (longPressTimer) clearTimeout(longPressTimer);
      // 單指長按重壓 -> 觸發拖曳模式 (滑鼠左鍵按下，伴隨重震動)
      longPressTimer = setTimeout(() => {
        hasTriggeredLongPress = true;
        
        isDragging = true;
        wasLongPressDrag = true;
        
        // 發送滑鼠左鍵按下
        const payload = new Uint8Array(1);
        payload[0] = 1; // Left click down
        sendInputPacket(buildInputPacket(0x02, payload));
        
        triggerHaptic("heavy");
        console.log("[Gesture] 單指長按重壓，觸發左鍵拖曳模式");
      }, 500); // 400→500ms：降低「手指稍停就誤觸拖曳/框選」的機率

      isDragging = false;
      // 雙擊拖曳（移動視窗/框選）只在「第二次觸碰落在上次點擊附近」時才預備，
      // 避免「點一下→移到別處」被誤判成拖曳。
      if (now - lastTapTime < 350) {
        const dFromLastTap = Math.hypot(lastTouchX - lastTapPos.x, lastTouchY - lastTapPos.y);
        if (dFromLastTap < 40) {
          isPotentialDrag = true;
        }
      }
    }
  }, { passive: false });

  videoEl.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 3 && isThreeFingerGesture) {
      if (threeFingerHasMoved) return;
      
      const avgX = (e.touches[0].clientX + e.touches[1].clientX + e.touches[2].clientX) / 3;
      const avgY = (e.touches[0].clientY + e.touches[1].clientY + e.touches[2].clientY) / 3;
      
      const dx = avgX - threeFingerStartPos.x;
      const dy = avgY - threeFingerStartPos.y;
      
      const distH = Math.abs(dx);
      const distV = Math.abs(dy);
      
      if (distH > 50 && distH > distV) {
        threeFingerHasMoved = true;
        if (dx > 0) {
          triggerMacShortcut("space-left");
          triggerHaptic("medium");
          console.log("[Gesture] 三指向右滑動，觸發切換至左邊桌面");
        } else {
          triggerMacShortcut("space-right");
          triggerHaptic("medium");
          console.log("[Gesture] 三指向左滑動，觸發切換至右邊桌面");
        }
      }
      return;
    }

    if (e.touches.length === 2) {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      const currentDistance = getPinchDistance(e.touches);
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
      // 雙指位移或捏合距離追蹤，用於過濾右鍵點擊
      const moveDist = Math.sqrt(Math.pow(centerX - touchStartPos.x, 2) + Math.pow(centerY - touchStartPos.y, 2));
      if (moveDist > 10 || (initialPinchDistance > 0 && Math.abs(currentDistance - initialPinchDistance) > 10)) {
        twoFingerHasMoved = true;
      }

      if (!isLocalPinching && initialPinchDistance > 0 && Math.abs(currentDistance - initialPinchDistance) > 30) {
        isLocalPinching = true;
      }

      if (isLocalPinching) {
        const scaleChange = currentDistance / initialPinchDistance;
        let newScale = pinchStartScale * scaleChange;
        newScale = Math.max(1.0, Math.min(newScale, 5.0));
        
        const dx = centerX - pinchStartCx;
        const dy = centerY - pinchStartCy;
        
        videoScale = newScale;
        videoTranslateX = pinchStartTx + dx;
        videoTranslateY = pinchStartTy + dy;
        
        if (videoScale === 1.0) {
          videoTranslateX = 0;
          videoTranslateY = 0;
        } else if (videoScale > 1.0 && videoContainer) {
          const containerWidth = videoContainer.clientWidth;
          const containerHeight = videoContainer.clientHeight;
          const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
          const containerRatio = containerWidth / containerHeight;
          
          let renderedWidth = containerWidth;
          let renderedHeight = containerHeight;
          if (containerRatio > videoRatio) {
            renderedHeight = containerHeight;
            renderedWidth = renderedHeight * videoRatio;
          } else {
            renderedWidth = containerWidth;
            renderedHeight = renderedWidth / videoRatio;
          }
          
          const maxTx = (renderedWidth * videoScale >= containerWidth) ? (renderedWidth * videoScale - containerWidth) / 2 : 0;
          const maxTy = (renderedHeight * videoScale >= containerHeight) ? (renderedHeight * videoScale - containerHeight) / 2 : 0;
          
          videoTranslateX = Math.max(-maxTx, Math.min(maxTx, videoTranslateX));
          videoTranslateY = Math.max(-maxTy, Math.min(maxTy, videoTranslateY));
        }
        
        applyVideoTransform();
      } else if (initialPinchDistance > 0) {
        if (lastTouchX !== 0 && lastTouchY !== 0) {
          const dy = Math.round((centerY - lastTouchY) * 1.5);
          const dx = Math.round((centerX - lastTouchX) * 1.5);
          
          if (dy !== 0 || dx !== 0) {
            const payload = new Uint8Array(4);
            const view = new DataView(payload.buffer);
            view.setInt16(0, dx, false);
            view.setInt16(2, dy, false);
            sendInputPacket(buildInputPacket(0x04, payload));
            
            const now = performance.now();
            const dt = now - lastScrollTimestamp;
            if (dt > 0 && dt < 100) {
              scrollVx = dx * (16 / dt);
              scrollVy = dy * (16 / dt);
            }
            lastScrollTimestamp = now;
            
            lastTouchX += (dx / 1.5);
            lastTouchY += (dy / 1.5);
          }
        }
      }
    } else if (e.touches.length === 1) {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      
      const dist = Math.sqrt(Math.pow(currentX - touchStartClientX, 2) + Math.pow(currentY - touchStartClientY, 2));
      if (dist > 10) {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }

      if (hasTriggeredLongPress) {
        // 長按重壓拖曳中：長按觸發後會直接進入 dragging，這裡交給下方的 isDragging 處理位置更新
      }
      
      const rect = videoEl.getBoundingClientRect();
      const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
      const containerRatio = rect.width / rect.height;
      
      let renderedWidth, renderedHeight, offsetX = 0, offsetY = 0;
      if (containerRatio > videoRatio) {
        renderedHeight = rect.height;
        renderedWidth = renderedHeight * videoRatio;
        offsetX = (rect.width - renderedWidth) / 2;
      } else {
        renderedWidth = rect.width;
        renderedHeight = renderedWidth / videoRatio;
        offsetY = (rect.height - renderedHeight) / 2;
      }
      
      renderedWidth = renderedWidth || window.innerWidth || 1;
      renderedHeight = renderedHeight || window.innerHeight || 1;

      if (isDirectTouchMode) {
        // 餵入邊緣平移迴圈所需的位置與旗標：直控模式下「手指位置 == 遠端游標位置」，
        // 與 startEdgePanLoop 的座標模型一致，可在放大後手指拖到邊緣時自動平移畫面。
        lastMouseClientX = currentX;
        lastMouseClientY = currentY;
        hasMouseMoved = true;
        isMouseInsideVideo = true;

        let x = (currentX - rect.left - offsetX) / renderedWidth;
        let y = (currentY - rect.top - offsetY) / renderedHeight;
        x = Math.max(0, Math.min(1, x));
        y = Math.max(0, Math.min(1, y));

        // 直控模式也即時繪製本地游標（被控端已關閉烘焙游標，避免直控下完全無游標）
        updateCursorOverlay(x, y);

        // Tremor Suppression (防手震) & Lazy Drag (延遲拖曳激活)
        if (!isDragging) {
          if (hasTriggeredLongPress || isPotentialDrag) {
            const startDist = Math.sqrt(Math.pow(currentX - touchStartPos.x, 2) + Math.pow(currentY - touchStartPos.y, 2));
            if (startDist > 14) {
              isDragging = true;
              isPotentialDrag = false;
              let startPctX = (touchStartPos.x - rect.left - offsetX) / renderedWidth;
              let startPctY = (touchStartPos.y - rect.top - offsetY) / renderedHeight;
              startPctX = Math.max(0, Math.min(1, startPctX));
              startPctY = Math.max(0, Math.min(1, startPctY));
              
              pendingMouseMoveX = startPctX;
              pendingMouseMoveY = startPctY;
              triggerMoveRaf();
              
              const payload = new Uint8Array(1);
              payload[0] = 1; // Left click down
              sendInputPacket(buildInputPacket(0x02, payload));
            }
          } else {
            // 普通單指滑動：只發送滑鼠移動，不觸發框選 (MouseDown)
            pendingMouseMoveX = x;
            pendingMouseMoveY = y;
            triggerMoveRaf();
          }
        } else {
          // 已進入拖曳狀態
          pendingMouseMoveX = x;
          pendingMouseMoveY = y;
          triggerMoveRaf();

          currentCursorPercentX = x;
          currentCursorPercentY = y;
        }
      } else {
        // 軌跡板模式下的移動
        if (isPotentialDrag) {
          // 雙擊後手指移動：如果移動超過微小閾值，真正激活拖曳模式
          const moveDist = Math.sqrt(Math.pow(currentX - touchStartPos.x, 2) + Math.pow(currentY - touchStartPos.y, 2));
          if (moveDist > 12) {
            isDragging = true;
            isPotentialDrag = false;
            const payload = new Uint8Array(1);
            payload[0] = 1; // Left click down
            sendInputPacket(buildInputPacket(0x02, payload));
            console.log("[Gesture] 雙擊拖曳模式激活");
          }
        }

        if (lastTouchX !== 0 && lastTouchY !== 0) {
          const dx = currentX - lastTouchX;
          const dy = currentY - lastTouchY;
          
          const accDx = applyAcceleration(dx);
          const accDy = applyAcceleration(dy);
          
          trackpadCursorX += accDx / renderedWidth;
          trackpadCursorY += accDy / renderedHeight;
          
          if (isNaN(trackpadCursorX)) trackpadCursorX = 0.5;
          if (isNaN(trackpadCursorY)) trackpadCursorY = 0.5;
          
          trackpadCursorX = Math.max(0, Math.min(1, trackpadCursorX));
          trackpadCursorY = Math.max(0, Math.min(1, trackpadCursorY));

          // 餵入邊緣平移迴圈：軌跡板模式以合成游標的螢幕位置判定邊緣（見 startEdgePanLoop）。
          // 游標被夾在內容邊界(0/1)且手指持續推動時，可在放大後持續平移視野。
          hasMouseMoved = true;
          isMouseInsideVideo = true;

          pendingMouseMoveX = trackpadCursorX;
          pendingMouseMoveY = trackpadCursorY;
          triggerMoveRaf();

          updateCursorOverlay(trackpadCursorX, trackpadCursorY);

          const now = performance.now();
          const dt = now - lastMoveTimestamp;
          if (dt > 0 && dt < 100) {
            momentumVx = (accDx / renderedWidth) * (16 / dt);
            momentumVy = (accDy / renderedHeight) * (16 / dt);
          }
          lastMoveTimestamp = now;

          currentCursorPercentX = trackpadCursorX;
          currentCursorPercentY = trackpadCursorY;
        }
      }
      
      lastTouchX = currentX;
      lastTouchY = currentY;
    }
  }, { passive: false });

  videoEl.addEventListener("touchend", (e) => {
    e.preventDefault();
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    const now = Date.now();

    if (isThreeFingerGesture) {
      if (!threeFingerHasMoved && touchStartTime > 0 && now - touchStartTime < 350) {
        triggerMacShortcut("mission-control");
        triggerHaptic("medium");
        console.log("[Gesture] 三指輕點，觸發 Mission Control");
      }
      isThreeFingerGesture = false;
      threeFingerHasMoved = false;
      maxTouches = 0;
      touchStartTime = 0;
      return;
    }

    // 雙指輕觸判定：無兩指大幅滑動 (!twoFingerHasMoved) 時，在第一根手指抬起時觸發右鍵
    if (maxTouches === 2) {
      if (touchStartTime > 0 && now - touchStartTime < 350 && !isLocalPinching && !twoFingerHasMoved) {
        const payloadDown = new Uint8Array(1);
        payloadDown[0] = 2; // Right click down
        sendInputPacket(buildInputPacket(0x02, payloadDown));
        
        setTimeout(() => {
          const payloadUp = new Uint8Array(1);
          payloadUp[0] = 2; // Right click up
          sendInputPacket(buildInputPacket(0x03, payloadUp));
          console.log("[Gesture] 雙指輕點，發送右鍵釋送完成");
        }, 60);
        
        triggerHaptic("heavy");
      }
      
      if (!isLocalPinching && (Math.abs(scrollVx) > SCROLL_MIN_VELOCITY || Math.abs(scrollVy) > SCROLL_MIN_VELOCITY)) {
        startScrollMomentum();
      }

      maxTouches = 0;
      touchStartTime = 0;
      initialPinchDistance = -1;
      twoFingerHasMoved = false;
      return;
    }
    
    if (e.touches.length === 0) {
      if (isKeyboardActive && mobileKeyboardInput && document.activeElement !== mobileKeyboardInput) {
        if (keyboardBar && !keyboardBar.contains(e.target as Node)) {
          isKeyboardActive = false;
          if (releaseAllHeldMods) releaseAllHeldMods();
          keyboardBar.style.visibility = "hidden";
          keyboardBar.style.opacity = "0";
          keyboardBar.style.pointerEvents = "none";
          // 恢復全螢幕
          const vc = document.getElementById("remote-video-container");
          if (vc) { vc.style.height = "100vh"; vc.style.top = "0px"; }
          keyboardBar.style.top = "auto";
          keyboardBar.style.bottom = "0";
          kbFocusClientY = -1;
          keyboardOffsetUpdateY = 0;
          applyVideoTransform();
          mobileKeyboardInput.blur();
        }
      }
      currentCursorPercentX = 0.5;
      currentCursorPercentY = 0.5;
      // 手指離開螢幕：停止邊緣自動平移
      isMouseInsideVideo = false;
      hasMouseMoved = false;

      if (hasTriggeredLongPress) {
        // 長按重壓拖曳結束：釋放滑鼠左鍵，並彈出懸浮選項選單
        const payload = new Uint8Array(1);
        payload[0] = 1; // Left click release
        sendInputPacket(buildInputPacket(0x03, payload));
        isDragging = false;
        
        const clientX = e.changedTouches.length > 0 ? e.changedTouches[0].clientX : window.innerWidth / 2;
        const clientY = e.changedTouches.length > 0 ? e.changedTouches[0].clientY : window.innerHeight / 2;
        showFloatingMenu(clientX, clientY);
        
        hasTriggeredLongPress = false;
        initialPinchDistance = -1;
        touchStartTime = 0;
        lastTapTime = now;
        lastTouchX = 0;
        lastTouchY = 0;
        maxTouches = 0;
        return;
      }
      
      const endX = e.changedTouches.length > 0 ? e.changedTouches[0].clientX : touchStartPos.x;
      const endY = e.changedTouches.length > 0 ? e.changedTouches[0].clientY : touchStartPos.y;
      
      if (isDirectTouchMode) {
        if (isDragging) {
          const payload = new Uint8Array(1);
          payload[0] = 1; // Left click release
          sendInputPacket(buildInputPacket(0x03, payload));
          isDragging = false;
          // 註：一般拖曳（拖視窗、捲動、移動圖示）結束不再彈出懸浮選單，
          // 懸浮選單只在「長按」這個明確手勢後出現（見上方 hasTriggeredLongPress 分支），避免太容易誤觸。
        } else {
          const tapDist = Math.sqrt(Math.pow(endX - lastTapPos.x, 2) + Math.pow(endY - lastTapPos.y, 2));
          if (now - lastTapTime < 350 && tapDist < 35) {
            sendDoubleClickSequence();
            lastTapTime = 0;
          } else {
            const rect = videoEl.getBoundingClientRect();
            const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
            const containerRatio = rect.width / rect.height;
            let renderedWidth, renderedHeight, offsetX = 0, offsetY = 0;
            if (containerRatio > videoRatio) {
              renderedHeight = rect.height;
              renderedWidth = renderedHeight * videoRatio;
              offsetX = (rect.width - renderedWidth) / 2;
            } else {
              renderedWidth = rect.width;
              renderedHeight = renderedWidth / videoRatio;
              offsetY = (rect.height - renderedHeight) / 2;
            }
            renderedWidth = renderedWidth || 1;
            renderedHeight = renderedHeight || 1;
            
            let x = (endX - rect.left - offsetX) / renderedWidth;
            let y = (endY - rect.top - offsetY) / renderedHeight;
            x = Math.max(0, Math.min(1, x));
            y = Math.max(0, Math.min(1, y));
            
            pendingMouseMoveX = x;
            pendingMouseMoveY = y;
            triggerMoveRaf();
            
            const payloadDown = new Uint8Array(1);
            payloadDown[0] = 1;
            sendInputPacket(buildInputPacket(0x02, payloadDown));
            triggerHaptic("light");
            setTimeout(() => {
              const payloadUp = new Uint8Array(1);
              payloadUp[0] = 1;
              sendInputPacket(buildInputPacket(0x03, payloadUp));
            }, 60);
            
            lastTapTime = now;
            lastTapPos = { x: endX, y: endY };
          }
        }
      } else {
        if (isDragging) {
          const payload = new Uint8Array(1);
          payload[0] = 1; // Left click release
          sendInputPacket(buildInputPacket(0x03, payload));
          isDragging = false;
          // 註：軌跡板一般拖曳結束不再彈出懸浮選單，只在「長按」手勢後出現（避免誤觸）。
        } else if (isPotentialDrag) {
          isPotentialDrag = false;
          sendDoubleClickSequence();
          lastTapTime = 0;
        } else {
          if (touchStartTime > 0 && now - touchStartTime < 450 && maxTouches === 1) {
            const dist = Math.sqrt(Math.pow(endX - touchStartPos.x, 2) + Math.pow(endY - touchStartPos.y, 2));
            if (dist < 35) {
              const tapDist = Math.sqrt(Math.pow(endX - lastTapPos.x, 2) + Math.pow(endY - lastTapPos.y, 2));
              if (now - lastTapTime < 350 && tapDist < 35) {
                sendDoubleClickSequence();
                lastTapTime = 0;
              } else {
                const payloadDown = new Uint8Array(1);
                payloadDown[0] = 1;
                sendInputPacket(buildInputPacket(0x02, payloadDown));
                triggerHaptic("light");
                setTimeout(() => {
                  const payloadUp = new Uint8Array(1);
                  payloadUp[0] = 1;
                  sendInputPacket(buildInputPacket(0x03, payloadUp));
                }, 20);

                // 單指點擊自動啟動鍵盤（虛擬或外接鍵盤皆適用），並記下點擊 Y 供自適應上移
                kbFocusClientY = endY;
                if (openMobileKeyboard) openMobileKeyboard();

                lastTapTime = now;
                lastTapPos = { x: endX, y: endY };
              }
            }
          }
        }
      }
      
      if (!isDragging && !isDirectTouchMode && (Math.abs(momentumVx) > MOMENTUM_MIN_VELOCITY || Math.abs(momentumVy) > MOMENTUM_MIN_VELOCITY)) {
        startMomentum();
      }

      initialPinchDistance = -1;
      touchStartTime = 0;
      lastTapTime = now;
      lastTouchX = 0;
      lastTouchY = 0;
      maxTouches = 0;
    } else if (e.touches.length === 1) {
      initialPinchDistance = -1;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  }, { passive: false });

  // 增加觸控防護：當遭遇衝突時，強制發送 MouseUp 並重置狀態，防止滑鼠死鎖
  videoEl.addEventListener("touchcancel", (e) => {
    e.preventDefault();
    console.log("[Gesture] 觸控被取消，重置狀態，釋放滑鼠按鍵");
    
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    hasTriggeredLongPress = false;
    currentCursorPercentX = 0.5;
    currentCursorPercentY = 0.5;
    // 觸控取消：停止邊緣自動平移
    isMouseInsideVideo = false;
    hasMouseMoved = false;

    const payloadLeft = new Uint8Array(1);
    payloadLeft[0] = 1;
    sendInputPacket(buildInputPacket(0x03, payloadLeft));

    const payloadRight = new Uint8Array(1);
    payloadRight[0] = 2;
    sendInputPacket(buildInputPacket(0x03, payloadRight));

    isDragging = false;
    isPotentialDrag = false;
    wasLongPressDrag = false;
    initialPinchDistance = -1;
    touchStartTime = 0;
    lastTouchX = 0;
    lastTouchY = 0;
    maxTouches = 0;
  }, { passive: false });

  videoEl.addEventListener("contextmenu", (e) => e.preventDefault());

  // 破壞性創新：非同步重投影 (Asynchronous Reprojection / Time Warping)
  let warpRaf: number | null = null;
  const applyTimeWarping = (dx: number, dy: number) => {
    warpX += dx;
    warpY += dy;
    if (warpRaf) cancelAnimationFrame(warpRaf);
    const decay = () => {
        warpX *= 0.85; // 快速衰減，模擬遠端畫面到達的覆蓋
        warpY *= 0.85;
        if (Math.abs(warpX) < 1 && Math.abs(warpY) < 1) {
            warpX = 0; warpY = 0;
            applyVideoTransform();
        } else {
            applyVideoTransform();
            warpRaf = requestAnimationFrame(decay);
        }
    };
    decay();
  };

  videoEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const payload = new Uint8Array(4);
    const view = new DataView(payload.buffer);
    const dx = Math.round(e.deltaX * -1); 
    const dy = Math.round(e.deltaY * -1);
    
    view.setInt16(0, dx, false);
    view.setInt16(2, dy, false);
    sendInputPacket(buildInputPacket(0x04, payload)); // 0x04 is MouseScroll

    // 觸發視覺預測 (Time Warping)
    applyTimeWarping(-e.deltaX * 0.5, -e.deltaY * 0.5); // 0.5 為體感係數
  }, { passive: false });

  const codeToKeyCode: Record<string, number> = {
    "Backspace": 8, "Tab": 9, "Enter": 13, "ShiftLeft": 16, "ShiftRight": 16,
    "ControlLeft": 17, "ControlRight": 17, "AltLeft": 18, "AltRight": 18,
    "Pause": 19, "CapsLock": 20, "Escape": 27, "Space": 32,
    "PageUp": 33, "PageDown": 34, "End": 35, "Home": 36,
    "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40,
    "Insert": 45, "Delete": 46,
    "Digit0": 48, "Digit1": 49, "Digit2": 50, "Digit3": 51, "Digit4": 52,
    "Digit5": 53, "Digit6": 54, "Digit7": 55, "Digit8": 56, "Digit9": 57,
    "KeyA": 65, "KeyB": 66, "KeyC": 67, "KeyD": 68, "KeyE": 69, "KeyF": 70,
    "KeyG": 71, "KeyH": 72, "KeyI": 73, "KeyJ": 74, "KeyK": 75, "KeyL": 76,
    "KeyM": 77, "KeyN": 78, "KeyO": 79, "KeyP": 80, "KeyQ": 81, "KeyR": 82,
    "KeyS": 83, "KeyT": 84, "KeyU": 85, "KeyV": 86, "KeyW": 87, "KeyX": 88,
    "KeyY": 89, "KeyZ": 90,
    "MetaLeft": 91, "MetaRight": 92, "ContextMenu": 93,
    "Numpad0": 96, "Numpad1": 97, "Numpad2": 98, "Numpad3": 99, "Numpad4": 100,
    "Numpad5": 101, "Numpad6": 102, "Numpad7": 103, "Numpad8": 104, "Numpad9": 105,
    "NumpadMultiply": 106, "NumpadAdd": 107, "NumpadSubtract": 109, "NumpadDecimal": 110, "NumpadDivide": 111,
    "F1": 112, "F2": 113, "F3": 114, "F4": 115, "F5": 116, "F6": 117,
    "F7": 118, "F8": 119, "F9": 120, "F10": 121, "F11": 122, "F12": 123,
    "NumLock": 144, "ScrollLock": 145,
    "Semicolon": 186, "Equal": 187, "Comma": 188, "Minus": 189, "Period": 190,
    "Slash": 191, "Backquote": 192, "BracketLeft": 219, "Backslash": 220,
    "BracketRight": 221, "Quote": 222
  };

  const activeKeys = new Set<string>();

  // 攔截鍵盤輸入 (直通 Scan Code 繞過輸入法)
  document.addEventListener("keydown", (e) => {
    if (!videoContainer || videoContainer.style.display === "none") return;
    if (document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT") {
      // 正在輸入欄位時，交由輸入法與虛擬鍵盤處理
      return;
    }
    
    e.preventDefault(); 
    
    const code = e.code || `Key_${e.keyCode}`;
    
    // 防重複觸發 (OS Key Repeat)
    if (activeKeys.has(code)) return;
    activeKeys.add(code);

    const payload = new Uint8Array(3);
    const view = new DataView(payload.buffer);
    
    // 優先使用物理按鍵位置的 Scan Code 映射，若無則降級使用 e.keyCode
    let keyCode = codeToKeyCode[e.code] || e.keyCode;
    if (keyCode === 0 || keyCode === 229) {
      if (e.key && e.key.length === 1) {
        keyCode = e.key.toUpperCase().charCodeAt(0);
      }
    }
    view.setUint16(0, keyCode, false);
    
    let modifiers = 0;
    if (e.shiftKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.altKey) modifiers |= 4;
    if (e.metaKey) modifiers |= 8;
    payload[2] = modifiers;
    
    sendInputPacket(buildInputPacket(0x05, payload)); 
  });

  // 新增 KeyUp 監聽，徹底解決按鍵卡死 (Ghosting) 問題
  document.addEventListener("keyup", (e) => {
    if (!videoContainer || videoContainer.style.display === "none") return;
    if (document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT") {
      return;
    }
    
    e.preventDefault(); 
    const code = e.code || `Key_${e.keyCode}`;
    activeKeys.delete(code);

    const payload = new Uint8Array(3);
    const view = new DataView(payload.buffer);
    
    let keyCode = codeToKeyCode[e.code] || e.keyCode;
    if (keyCode === 0 || keyCode === 229) {
      if (e.key && e.key.length === 1) {
        keyCode = e.key.toUpperCase().charCodeAt(0);
      }
    }
    view.setUint16(0, keyCode, false);
    
    let modifiers = 0;
    if (e.shiftKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.altKey) modifiers |= 4;
    if (e.metaKey) modifiers |= 8;
    payload[2] = modifiers;
    
    sendInputPacket(buildInputPacket(0x06, payload)); 
  });

  // --- 行動端虛擬鍵盤事件監聽與防失焦機制 ---
  const sendKeyStroke = (keyCode: number) => {
    const payload = new Uint8Array(3);
    const view = new DataView(payload.buffer);
    view.setUint16(0, keyCode, false);
    payload[2] = 0; // modifiers = 0
    
    // 依序發送 KeyDown (0x05) 與 KeyUp (0x06)，防範被控端按鍵卡死
    sendInputPacket(buildInputPacket(0x05, payload));
    sendInputPacket(buildInputPacket(0x06, payload));
  };



  const handleEnter = () => {
    sendKeyStroke(13);
  };

  // --- 行動端 Keyboard Bar 邏輯 ---
  if (keyboardBar && mobileKeyboardInput && btnKeyboardSend) {
    let isResetting = false;
    let previousValueLength = 0;

    const resetInput = () => {
      mobileKeyboardInput.value = "\u200B";
    };

    // =========================================================================
    // 桌面修飾鍵工具列（⌘⌃⌥⇧ + Esc/Tab/方向鍵）
    // 仿 Chrome 遠端桌面：修飾鍵為「按住/再按放開」的鎖定切換，按住期間軟鍵盤
    // 打出的字母改以「按鍵事件 (0x05/0x06)」送出，與被控端真實按住的修飾鍵組合。
    // 被控端 host 兩平台皆忽略 modifiers 位元組，純靠真實按住的修飾鍵碼建立狀態。
    // =========================================================================
    interface HeldMod { code: number; bit: number; el: HTMLButtonElement; }
    const heldMods = new Map<string, HeldMod>();
    let activeModBits = 0;
    const recomputeModBits = () => {
      activeModBits = 0;
      heldMods.forEach((m) => { activeModBits |= m.bit; });
    };
    const releaseAllMods = () => {
      heldMods.forEach((m) => {
        releaseKey(m.code, 0);
        m.el.classList.remove("modkey-active");
      });
      heldMods.clear();
      activeModBits = 0;
    };
    releaseAllHeldMods = releaseAllMods;

    // 把單一字元映射為 Windows VK 碼（host 端再轉各平台），僅處理英數，其餘回退文字注入
    const charToVk = (ch: string): number | null => {
      if (/^[a-zA-Z]$/.test(ch)) return ch.toUpperCase().charCodeAt(0);
      if (/^[0-9]$/.test(ch)) return ch.charCodeAt(0);
      return null;
    };

    const modkeyRow = document.getElementById("mobile-modkey-row");
    if (modkeyRow) {
      const buttons = modkeyRow.querySelectorAll<HTMLButtonElement>(".modkey");
      buttons.forEach((btn) => {
        const modAttr = btn.dataset.mod;   // 修飾鍵（鎖定切換）
        const keyAttr = btn.dataset.key;   // 一次性特殊鍵
        // 用 pointerdown + preventDefault：避免搶走輸入框焦點（否則會誤觸發收鍵盤）
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (modAttr) {
            const code = parseInt(modAttr, 10);
            const bit = parseInt(btn.dataset.bit || "0", 10);
            if (heldMods.has(modAttr)) {
              releaseKey(code, 0);
              heldMods.delete(modAttr);
              btn.classList.remove("modkey-active");
            } else {
              pressKey(code, bit);
              heldMods.set(modAttr, { code, bit, el: btn });
              btn.classList.add("modkey-active");
            }
            recomputeModBits();
            triggerHaptic("light");
          } else if (keyAttr) {
            const code = parseInt(keyAttr, 10);
            // 特殊鍵與目前按住的修飾鍵組合送出，修飾鍵維持按住（方便連續操作）
            pressKey(code, activeModBits);
            setTimeout(() => releaseKey(code, activeModBits), 20);
            triggerHaptic("light");
          }
        }, { passive: false });
      });
    }


    // 開啟鍵盤的核心邏輯（供單指點擊觸發虛擬/實體鍵盤共用）
    let keyboardOpenGuard = false;
    openMobileKeyboard = () => {
      if (keyboardOpenGuard) return;
      keyboardOpenGuard = true;
      setTimeout(() => keyboardOpenGuard = false, 300);

      isKeyboardActive = true;
      keyboardBar.style.visibility = "visible";
      keyboardBar.style.opacity = "1";
      keyboardBar.style.pointerEvents = "auto";

      // iOS Safari 強制要求：focus() 必須在使用者手勢的同步呼叫鏈內，
      // 且必須在任何 setTimeout 之前執行，否則虛擬鍵盤不會彈出。
      mobileKeyboardInput.focus();

      // focus 之後再重設 input 值（不影響鍵盤彈出）
      resetInput();
    };

    // 把一段文字以 String Packet (0x08) 即時注入被控端目前焦點欄位
    const sendTextChunk = (text: string) => {
      if (!text) return;
      const payload = new TextEncoder().encode(text);
      sendInputPacket(buildInputPacket(0x08, payload));
    };

    const sendText = () => {
      const val = mobileKeyboardInput.value.replace(/​/g, "");
      if (val.length > 0) {
        sendTextChunk(val);
        resetInput();
      }
    };

    // 送出鈕保留為手動 flush（live 模式下欄位通常已即時清空）
    btnKeyboardSend.addEventListener("click", () => {
      sendText();
    });

    // =========================================================================
    // 即時輸入（Live Typing）：邊打邊送到遠端焦點欄位
    // - 中文/日文等以 IME 組字：組字中不送，compositionend 時整段送出
    // - 一般字元 / 退格 / 換行：input 當下即時送，並把欄位清回 sentinel，
    //   讓下一次 input 只攜帶「新輸入的增量」。
    // =========================================================================
    let imeComposing = false;
    mobileKeyboardInput.addEventListener("compositionstart", () => {
      imeComposing = true;
    });
    mobileKeyboardInput.addEventListener("compositionend", (e) => {
      imeComposing = false;
      const data = (e as CompositionEvent).data || "";
      if (data) sendTextChunk(data); // 注音/拼音組好的字整段送出
      resetInput();
    });

    mobileKeyboardInput.addEventListener("input", (e) => {
      const ie = e as InputEvent;
      if (imeComposing || ie.isComposing) return; // 組字中，等 compositionend
      const it = ie.inputType || "";
      if (it.startsWith("delete")) {
        sendKeyStroke(8); // 退格即時送
      } else if (it === "insertLineBreak" || it === "insertParagraph") {
        sendKeyStroke(13); // 換行 → 遠端 Enter
      } else {
        const val = mobileKeyboardInput.value.replace(/​/g, "");
        if (val) {
          // 有按住修飾鍵且為單一英數字元 → 以按鍵事件組合送出（達成 ⌘C/⌃V… 等快捷鍵）
          const vk = activeModBits !== 0 && val.length === 1 ? charToVk(val) : null;
          if (vk !== null) {
            pressKey(vk, activeModBits);
            releaseKey(vk, activeModBits);
          } else {
            sendTextChunk(val); // 一般打字即時送
          }
        }
      }
      resetInput(); // 立即清回 sentinel，下個按鍵只帶新字
    });

    // 部分 iOS 軟鍵盤的 Return 走 keydown 而非 input，這裡補送 Enter
    mobileKeyboardInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendKeyStroke(13);
      }
    });

    mobileKeyboardInput.addEventListener("blur", () => {
      // 延遲隱藏：iOS Safari 彈出虛擬鍵盤時會觸發假 blur，需足夠長的延遲避免誤關
      setTimeout(() => {
        if (keyboardOpenGuard) return; // 正在開啟鍵盤，忽略此次 blur
        if (document.activeElement !== mobileKeyboardInput) {
          isKeyboardActive = false;
          if (releaseAllHeldMods) releaseAllHeldMods();
          keyboardBar.style.visibility = "hidden";
          keyboardBar.style.opacity = "0";
          keyboardBar.style.pointerEvents = "none";

          // 立即恢復視訊容器為全螢幕（不等 visualViewport resize 回調）
          const container = document.getElementById("remote-video-container");
          if (container) {
            container.style.height = "100vh";
            container.style.top = "0px";
          }
          keyboardBar.style.top = "auto";
          keyboardBar.style.bottom = "0";
          kbFocusClientY = -1;
          keyboardOffsetUpdateY = 0;
          applyVideoTransform();
        }
      }, 300);
    });
  }

  // Visual Viewport 自適應邏輯（仿 Chrome 遠端桌面）：
  // 鍵盤彈出時「不壓縮」視訊容器（桌面保持全尺寸、清晰可讀），改為只把畫面
  // 上移到剛好露出使用者點擊的焦點之上；焦點本就在可見區則完全不動。
  // 這避免了舊版把整個桌面縮成頂部一小條的可視性問題。
  if (window.visualViewport) {
    const onViewportChange = () => {
      const vv = window.visualViewport;
      if (!vv) return;

      const container = document.getElementById("remote-video-container");
      if (!container) return;

      // 容器始終維持全螢幕，桌面以原始比例完整呈現
      container.style.height = "100vh";
      container.style.top = "0px";

      const isKbOpen = isKeyboardActive || document.activeElement === mobileKeyboardInput;
      // 動態量測 keyboard bar 實際高度（修飾鍵列 + 輸入列），避免寫死失準
      const barHeight = keyboardBar ? keyboardBar.offsetHeight || 100 : 100;

      if (isKbOpen) {
        // 系統鍵盤頂端在螢幕上的 Y；我們的工具列再疊在它正上方
        const sysKbTop = vv.offsetTop + vv.height;
        const barTop = sysKbTop - barHeight;
        if (keyboardBar) {
          keyboardBar.style.position = "fixed";
          keyboardBar.style.top = `${barTop}px`;
          keyboardBar.style.bottom = "auto";
        }

        // Android WebView 會原生縮放 layout viewport，自行手動平移反而導致黑屏，故不上移
        if (/android/i.test(navigator.userAgent)) {
          keyboardOffsetUpdateY = 0;
          applyVideoTransform();
          window.scrollTo(0, 0);
          return;
        }

        // 可見區下緣（工具列上方）。若點擊焦點落在它之下，往上平移剛好露出焦點。
        const visibleBottom = barTop;
        const margin = 24; // 焦點與工具列之間留一點呼吸空間
        let pan = 0;
        if (kbFocusClientY >= 0 && kbFocusClientY > visibleBottom - margin) {
          pan = kbFocusClientY - (visibleBottom - margin);
        }
        // 上移量不超過被鍵盤遮蔽的高度，避免把畫面推過頭
        const maxPan = window.innerHeight - vv.height + barHeight;
        keyboardOffsetUpdateY = -Math.max(0, Math.min(pan, maxPan));
        applyVideoTransform();

        // 防止 iOS Safari 將頁面推離視窗
        window.scrollTo(0, 0);
      } else {
        if (keyboardBar) {
          keyboardBar.style.top = "auto";
          keyboardBar.style.bottom = "0";
        }
        keyboardOffsetUpdateY = 0;
        applyVideoTransform();
      }
    };

    window.visualViewport.addEventListener("resize", onViewportChange);
    window.visualViewport.addEventListener("scroll", onViewportChange);
    // 初始化呼叫
    onViewportChange();
  }

  // 點擊視訊畫面時關閉鍵盤並恢復全螢幕
  videoEl.addEventListener("click", () => {
    if (isKeyboardActive && mobileKeyboardInput && document.activeElement !== mobileKeyboardInput) {
      isKeyboardActive = false;
      if (releaseAllHeldMods) releaseAllHeldMods();
      keyboardBar.style.visibility = "hidden";
      keyboardBar.style.opacity = "0";
      keyboardBar.style.pointerEvents = "none";

      // 恢復視訊容器全螢幕
      const container = document.getElementById("remote-video-container");
      if (container) {
        container.style.height = "100vh";
        container.style.top = "0px";
      }
      keyboardBar.style.top = "auto";
      keyboardBar.style.bottom = "0";
      kbFocusClientY = -1;
      keyboardOffsetUpdateY = 0;
      applyVideoTransform();

      // 強制收起虛擬鍵盤
      mobileKeyboardInput.blur();
    }
  });

  // 監聽失去焦點與頁面隱藏事件，清空 Host 卡死按鍵
  const onResetTrigger = () => {
    if (videoContainer && videoContainer.style.display !== "none") {
      activeKeys.clear();
      const payload = new Uint8Array(0);
      sendInputPacket(buildInputPacket(0xFF, payload));
      console.log("[Input] 失去焦點或切換分頁，發送 ResetState (0xFF) 清空被控端修飾鍵狀態");
    }
  };

  window.addEventListener("blur", onResetTrigger);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      onResetTrigger();
    }
  });

  // 建立精美的懸浮功能選單 (Floating Option Menu)
  let activeFloatingMenu: HTMLDivElement | null = null;

  const showFloatingMenu = (x: number, y: number) => {
    // 先移除舊選單
    if (activeFloatingMenu) {
      activeFloatingMenu.remove();
      activeFloatingMenu = null;
    }

    const menu = document.createElement("div");
    activeFloatingMenu = menu;
    menu.id = "floating-selection-menu";
    
    // 毛玻璃玻璃擬態 Glassmorphism 精美樣式
    menu.style.position = "fixed";
    menu.style.left = `${x}px`;
    menu.style.top = `${y - 65}px`; // 顯示在點擊位置上方 65 像素
    menu.style.transform = "translateX(-50%) scale(0.9)";
    menu.style.opacity = "0";
    menu.style.transition = "all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)";
    menu.style.zIndex = "3000";
    menu.style.background = "rgba(15, 23, 42, 0.85)";
    menu.style.backdropFilter = "blur(16px)";
    menu.style.setProperty("-webkit-backdrop-filter", "blur(16px)");
    menu.style.border = "1px solid rgba(255, 255, 255, 0.2)";
    menu.style.borderRadius = "12px";
    menu.style.padding = "4px 8px";
    menu.style.display = "flex";
    menu.style.flexDirection = "row";
    menu.style.gap = "4px";
    menu.style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)";

    // 選單選項清單
    const options = [
      { label: "📋 複製", action: "copy" },
      { label: "📥 貼上", action: "paste" },
      { label: "🔍 全選", action: "selectall" },
      { label: "⚡ 右鍵", action: "rightclick" },
      { label: "✕", action: "cancel" }
    ];

    options.forEach(opt => {
      const btn = document.createElement("button");
      btn.textContent = opt.label;
      btn.style.background = "transparent";
      btn.style.border = "none";
      btn.style.color = "white";
      btn.style.fontSize = "12px";
      btn.style.fontWeight = "600";
      btn.style.padding = "6px 10px";
      btn.style.borderRadius = "8px";
      btn.style.cursor = "pointer";
      btn.style.transition = "all 0.15s ease";
      btn.style.whiteSpace = "nowrap";

      btn.addEventListener("mouseenter", () => {
        btn.style.background = "rgba(255, 255, 255, 0.15)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "transparent";
      });

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerHaptic("light");
        
        const ctrlCode = 17;
        const winCode = 91;
        const cCode = 67;
        const vCode = 86;
        const aCode = 65;



        if (opt.action === "copy") {
          // macOS: Cmd + C, Windows: Ctrl + C (同時發送相容雙系統)
          pressKey(winCode, 8); // Meta Down (Mac Cmd)
          pressKey(cCode, 8);
          setTimeout(() => {
            releaseKey(cCode, 8);
            releaseKey(winCode, 0);
            
            // Windows
            pressKey(ctrlCode, 2);
            pressKey(cCode, 2);
            setTimeout(() => {
              releaseKey(cCode, 2);
              releaseKey(ctrlCode, 0);
            }, 20);
          }, 20);
        } else if (opt.action === "paste") {
          // macOS: Cmd + V, Windows: Ctrl + V
          pressKey(winCode, 8);
          pressKey(vCode, 8);
          setTimeout(() => {
            releaseKey(vCode, 8);
            releaseKey(winCode, 0);
            
            // Windows
            pressKey(ctrlCode, 2);
            pressKey(vCode, 2);
            setTimeout(() => {
              releaseKey(vCode, 2);
              releaseKey(ctrlCode, 0);
            }, 20);
          }, 20);
        } else if (opt.action === "selectall") {
          // macOS: Cmd + A, Windows: Ctrl + A
          pressKey(winCode, 8);
          pressKey(aCode, 8);
          setTimeout(() => {
            releaseKey(aCode, 8);
            releaseKey(winCode, 0);
            
            // Windows
            pressKey(ctrlCode, 2);
            pressKey(aCode, 2);
            setTimeout(() => {
              releaseKey(aCode, 2);
              releaseKey(ctrlCode, 0);
            }, 20);
          }, 20);
        } else if (opt.action === "rightclick") {
          const payloadDown = new Uint8Array(1);
          payloadDown[0] = 2; // Right click down
          sendInputPacket(buildInputPacket(0x02, payloadDown));
          setTimeout(() => {
            const payloadUp = new Uint8Array(1);
            payloadUp[0] = 2; // Right click up
            sendInputPacket(buildInputPacket(0x03, payloadUp));
          }, 60);
        }

        // 點擊後隱藏選單
        menu.style.transform = "translateX(-50%) scale(0.9)";
        menu.style.opacity = "0";
        setTimeout(() => {
          menu.remove();
          if (activeFloatingMenu === menu) activeFloatingMenu = null;
        }, 200);
      });

      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    
    // 觸發進場動畫
    requestAnimationFrame(() => {
      menu.style.transform = "translateX(-50%) scale(1)";
      menu.style.opacity = "1";
    });
  };

  // 全局點擊時關閉懸浮選單
  document.addEventListener("click", (e) => {
    if (activeFloatingMenu && !activeFloatingMenu.contains(e.target as Node)) {
      const menu = activeFloatingMenu;
      menu.style.transform = "translateX(-50%) scale(0.9)";
      menu.style.opacity = "0";
      setTimeout(() => {
        menu.remove();
        if (activeFloatingMenu === menu) activeFloatingMenu = null;
      }, 200);
    }
  });

}

// =========================================================================
// UI Toggle 邏輯 (右側進階面板)
// =========================================================================
function initPanelToggle() {
  const btnTogglePanel = document.getElementById("btn-toggle-panel");
  const advancedPanel = document.getElementById("advanced-panel");
  
  if (btnTogglePanel && advancedPanel) {
    btnTogglePanel.addEventListener("click", () => {
      advancedPanel.classList.toggle("panel-open");
    });
  }

  const btnShowHelp = document.getElementById("btn-show-help");
  const btnCloseHelp = document.getElementById("btn-close-help");
  const helpModal = document.getElementById("help-modal");
  
  if (btnShowHelp && btnCloseHelp && helpModal) {
    btnShowHelp.addEventListener("click", () => {
      helpModal.style.display = "flex";
      switchHelpTab("controls");
    });
    btnCloseHelp.addEventListener("click", () => {
      helpModal.style.display = "none";
    });
    helpModal.addEventListener("click", (e) => {
      if (e.target === helpModal) {
        helpModal.style.display = "none";
      }
    });

    const tabBtnControls = document.getElementById("tab-btn-controls");
    const tabBtnPrivacy = document.getElementById("tab-btn-privacy");
    if (tabBtnControls) {
      tabBtnControls.onclick = (e) => {
        e.stopPropagation();
        switchHelpTab("controls");
      };
    }
    if (tabBtnPrivacy) {
      tabBtnPrivacy.onclick = (e) => {
        e.stopPropagation();
        switchHelpTab("privacy");
      };
    }
  }
}

// =========================================================================
// 遠端主機除錯日誌診斷 Modal 與事件綁定
// =========================================================================
function initRemoteLogsDiagnostics() {
  const btnDiagnose = document.getElementById("btn-video-diagnose");
  const btnCloseLogs = document.getElementById("btn-close-remote-logs");
  const modal = document.getElementById("remote-logs-modal");
  const container = document.getElementById("remote-logs-container");

  if (btnDiagnose) {
    btnDiagnose.addEventListener("click", () => {
      if (signalingWs && signalingWs.readyState === WebSocket.OPEN && currentRemoteId) {
        console.log(`[Diagnostic] 發送遠端主機除錯日誌索取請求給 ${currentRemoteId}`);
        signalingWs.send(JSON.stringify({
          type: "custom_request_logs",
          target: currentRemoteId,
          source: myId
        }));
        
        if (container) {
          container.textContent = t("loading_remote_logs") || "Loading remote logs...";
        }
        if (modal) {
          modal.style.display = "flex";
        }
      } else {
        showToast("Signaling channel not available or remote ID not found.");
      }
    });
  }

  if (btnCloseLogs && modal) {
    btnCloseLogs.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    });
  }
}

// =========================================================================
// Tailscale 零基礎穿透說明書 Modal 事件綁定
// =========================================================================
function initTailscaleGuide() {
  const modal = document.getElementById("tailscale-guide-modal");
  const btnClose = document.getElementById("btn-close-ts-guide");

  if (btnClose && modal) {
    btnClose.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    });
  }

  // 自訂 TURN Server 邏輯
  const btnSaveTurn = document.getElementById("btn-save-turn");
  const taCustomTurn = document.getElementById("ta-custom-turn") as HTMLTextAreaElement;
  
  if (taCustomTurn) {
    const saved = localStorage.getItem("custom_turn_servers");
    if (saved) {
      taCustomTurn.value = saved;
    }
  }

  if (btnSaveTurn && taCustomTurn) {
    btnSaveTurn.addEventListener("click", () => {
      try {
        const val = taCustomTurn.value.trim();
        if (!val) {
          localStorage.removeItem("custom_turn_servers");
        } else {
          // 驗證 JSON 格式
          const parsed = JSON.parse(val);
          if (!Array.isArray(parsed)) throw new Error("Not an array");
          localStorage.setItem("custom_turn_servers", JSON.stringify(parsed));
        }
        showToast("TURN Servers saved! Reloading...");
        setTimeout(() => window.location.reload(), 1000);
      } catch (e) {
        alert(t("alert_turn_json_error"));
      }
    });
  }
}

// =========================================================================
// Access PIN 顯示/隱藏切換事件綁定
// =========================================================================
function initPinToggle() {
  const btnToggle = document.getElementById("btn-toggle-pin");
  const inputPin = document.getElementById("access-pin-input") as HTMLInputElement;

  if (btnToggle && inputPin) {
    btnToggle.addEventListener("click", () => {
      isPinVisible = !isPinVisible;
      if (isPinVisible) {
        inputPin.type = "text";
        btnToggle.textContent = t("btn_hide");
      } else {
        inputPin.type = "password";
        btnToggle.textContent = t("btn_show");
      }
    });
  }
}

// =========================================================================
// Quick Menu 控制面板事件初始化 (全域僅綁定一次)
// =========================================================================
function initQuickMenu() {
  const btnSessionDisconnect = document.getElementById("btn-session-disconnect");
  if (btnSessionDisconnect) {
    // 註：iOS WKWebView 對原生 window.confirm() 支援不可靠（可能不彈窗或直接回傳 false），
    // 會導致「登出」按了沒反應。改為直接斷線、不依賴 confirm。
    btnSessionDisconnect.onclick = (e) => {
      e.stopPropagation();
      console.log("[RemoteSession] Session Disconnect clicked");
      if (peerConnection) {
        try {
          peerConnection.close();
        } catch (err) {
          console.warn("[WebRTC] Error closing peerConnection:", err);
        }
        peerConnection = null;
      }
      dataChannelControl = null;
      dataChannelUnreliable = null;
      dataChannelClipboard = null;
      dataChannelFileTransfer = null;
      dataChannelSystemControl = null;
      iceCandidateQueue = [];
      resetConnectionUI();
    };
  }

  const controlToggle = document.getElementById("btn-control-toggle");
  const controlPanel = document.getElementById("control-dock-panel");
  const toggleArrow = document.getElementById("control-toggle-arrow");
  const btnTouchMode = document.getElementById("btn-touch-mode") as HTMLButtonElement;
  const btnSendKeys = document.getElementById("btn-send-keys") as HTMLButtonElement;
  const shortcutsDropdown = document.getElementById("shortcuts-dropdown") as HTMLDivElement;
  const btnDisconnect = document.getElementById("btn-disconnect") as HTMLButtonElement;

  if (controlToggle && controlPanel && toggleArrow) {
    controlToggle.onclick = (e) => {
      e.stopPropagation();
      isPanelOpen = !isPanelOpen;
      console.log("[QuickMenu] Toggle click, isPanelOpen:", isPanelOpen);
      if (isPanelOpen) {
        controlPanel.style.maxHeight = "200px";
        controlPanel.style.opacity = "1";
        controlPanel.style.pointerEvents = "auto";
        controlPanel.style.transform = "translateY(0)";
        toggleArrow.textContent = "▲";
        toggleArrow.style.transform = "rotate(180deg)";
      } else {
        controlPanel.style.maxHeight = "0px";
        controlPanel.style.opacity = "0";
        controlPanel.style.pointerEvents = "none";
        controlPanel.style.transform = "translateY(-10px)";
        toggleArrow.textContent = "▼";
        toggleArrow.style.transform = "rotate(0deg)";
      }
    };
  }

  if (btnTouchMode) {
    btnTouchMode.onclick = () => {
      isDirectTouchMode = !isDirectTouchMode;
      console.log("[QuickMenu] Touch mode toggled, isDirectTouchMode:", isDirectTouchMode);
      if (isDirectTouchMode) {
        btnTouchMode.textContent = "👆 Direct Touch";
      } else {
        btnTouchMode.textContent = "🖱️ Trackpad Mode";
      }
    };
  }

  if (btnSendKeys && shortcutsDropdown) {
    btnSendKeys.onclick = (e) => {
      e.stopPropagation();
      const isOpen = shortcutsDropdown.style.display === "flex";
      shortcutsDropdown.style.display = isOpen ? "none" : "flex";
    };
  }

  document.addEventListener("click", () => {
    if (shortcutsDropdown) {
      shortcutsDropdown.style.display = "none";
    }
  });

  document.querySelectorAll(".shortcut-item").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    el.onclick = (e) => {
      e.stopPropagation();
      const keys = el.getAttribute("data-keys");
      console.log("[QuickMenu] Shortcut clicked:", keys);
      if (keys === "ctrl-alt-del") {
        pressKey(17, 2);
        pressKey(18, 6);
        pressKey(46, 6);
        setTimeout(() => {
          releaseKey(46, 6);
          releaseKey(18, 2);
          releaseKey(17, 0);
        }, 50);
      } else if (keys === "win") {
        pressKey(91, 8);
        setTimeout(() => {
          releaseKey(91, 0);
        }, 50);
      } else if (keys === "alt-tab") {
        pressKey(18, 4);
        pressKey(9, 4);
        setTimeout(() => {
          releaseKey(9, 4);
          releaseKey(18, 0);
        }, 50);
      } else if (keys === "ctrl-esc") {
        pressKey(17, 2);
        pressKey(27, 2);
        setTimeout(() => {
          releaseKey(27, 2);
          releaseKey(17, 0);
        }, 50);
      }
      if (shortcutsDropdown) {
        shortcutsDropdown.style.display = "none";
      }
    };
  });

  if (btnDisconnect) {
    btnDisconnect.onclick = () => {
      console.log("[QuickMenu] Disconnect clicked");
      if (confirm(t("ui_confirm_disconnect"))) {
        if (peerConnection) {
          try {
            peerConnection.close();
          } catch (e) {
            console.warn("[WebRTC] Error closing peerConnection:", e);
          }
          peerConnection = null;
        }
        dataChannelControl = null;
        dataChannelUnreliable = null;
        dataChannelClipboard = null;
        dataChannelFileTransfer = null;
        dataChannelSystemControl = null;
        iceCandidateQueue = [];
        resetConnectionUI();
      }
    };
  }
}

// =========================================================================
// 應用程式初始化入口點
// =========================================================================
async function initializeApp() {
  if (pkg.version) {
    // 同步更新網頁標題，讓 Mac/Windows 原生視窗的標題列也能顯示版本號
    document.title = `2syn_Duel v${pkg.version}`;
  }
  setupFileTransferDropZone(() => dataChannelFileTransfer);
  initDeviceBook();

  await initI18n();

  // 啟動時檢查並請求 macOS 權限 (螢幕錄影、輔助使用)
  if (isDesktopTauri()) {
    try {
      const permissionsGranted = await invoke<boolean>("check_macos_permissions");
      const warningBanner = document.getElementById("permission-warning-banner");
      const permModal = document.getElementById("permission-modal");
      const btnFixPerm = document.getElementById("btn-fix-permissions");
      const btnClosePerm = document.getElementById("btn-close-perm");
      const btnRepromptPerm = document.getElementById("btn-perm-modal-trigger");

      if (!permissionsGranted) {
        console.warn("macOS permissions are missing. Native prompt should have appeared.");
        if (warningBanner) warningBanner.style.display = "flex";
      }

      if (btnFixPerm && permModal) {
        btnFixPerm.addEventListener("click", () => {
          permModal.style.display = "flex";
        });
      }
      if (btnClosePerm && permModal) {
        btnClosePerm.addEventListener("click", () => {
          permModal.style.display = "none";
        });
      }
      if (permModal) {
        permModal.addEventListener("click", (e) => {
          if (e.target === permModal) {
            permModal.style.display = "none";
          }
        });
      }
      if (btnRepromptPerm) {
        btnRepromptPerm.addEventListener("click", async () => {
          try {
            const recheck = await invoke<boolean>("check_macos_permissions");
            if (recheck) {
              if (warningBanner) warningBanner.style.display = "none";
              if (permModal) permModal.style.display = "none";
              alert("Permissions granted successfully! Application is ready.");
            } else {
              alert("Permissions still missing. Please ensure they are checked in macOS System Settings.");
            }
          } catch (err) {
            console.error("Failed to recheck macOS permissions:", err);
          }
        });
      }
    } catch (err) {
      console.error("Failed to check macOS permissions:", err);
    }
  }

  const generatedId = generateMockMyId();
  if (generatedId) myId = generatedId;

  await fetchHwid();
  await loadMyMac();
  
  initConnectButton();
  initQuickMenu();
  // initLicenseVerification();
  initPrivacyMode();
  initAutostart();
  initNetworkSimulator();
  initSignalingReconnect();
  initStaticPassword();
  initPanelToggle();
  initOfflineSdpMode();
  initSystemDiagnostic();
  initHelpButtons();
  initClipboardCopy();
  initSmartAutoMode();
  initFileTransfer();
  initRemoteLogsDiagnostics();
  initTailscaleGuide();
  initPinToggle();
  initFirstRunPrompt();
  
  // 啟動狀態輪詢
  startStatusPolling();

  // 依據 Host 與 Client 的產品定位，動態調整左側控制面板顯隱狀態
  if (isDesktopTauri()) {
    // macOS / Windows Desktop: 雙向一體化 (Host + Client)，兩者皆保留，無需隱藏
    console.log("[UI] Desktop mode: Host and Client UI both enabled.");
  } else {
    // Client 主控端 (iOS / Android / 純網頁)：不需要「本機資訊」、「固定密碼」與「買斷金鑰」
    const localHostInfo = document.getElementById("local-host-info-section");
    if (localHostInfo) {
      localHostInfo.style.display = "none";
    }

    // 優化主控端的網路體質診斷顯示，並常態開啟穿透提示按鈕
    const networkIndicator = document.getElementById("network-health-indicator");
    const networkText = document.getElementById("network-health-text");
    const networkDesc = document.getElementById("network-health-desc");
    const btnFixNetwork = document.getElementById("btn-fix-network");

    if (networkIndicator) networkIndicator.style.backgroundColor = "var(--success-color, #10b981)";
    if (networkText) {
      networkText.textContent = "Web Client (P2P Ready)";
      networkText.style.color = "var(--success-color, #10b981)";
    }
    if (networkDesc) {
      networkDesc.textContent = t("desc_web_client_info");
    }
    if (btnFixNetwork) {
      btnFixNetwork.style.display = "inline-block";
    }
  }

  // 網頁控制端（Client）聚焦與可見度狀態檢測重連
  if (!isDesktopTauri()) {
    window.addEventListener("focus", () => {
      const videoContainer = document.getElementById("remote-video-container") as HTMLElement;
      if (videoContainer && videoContainer.style.display === "none") {
        if (!signalingWs || signalingWs.readyState !== WebSocket.OPEN) {
          console.log(t("log_sig_focus_reconnect"));
          initSignalingClient();
        } else {
          console.log("[Signaling] 網頁控制端獲得焦點，發送 ping 驗證連線...");
          signalingWs.send(JSON.stringify({ type: "ping" }));
        }
      }
    });

    document.addEventListener("visibilitychange", () => {
      const videoContainer = document.getElementById("remote-video-container") as HTMLElement;
      if (!document.hidden && videoContainer && videoContainer.style.display === "none") {
        if (!signalingWs || signalingWs.readyState !== WebSocket.OPEN) {
          console.log(t("log_sig_visible_reconnect"));
          initSignalingClient();
        }
      }
    });
  }

  // 啟動信令連線分流：Tauri 桌面端 Host 走 Rust 後端，Web 控制端走 JS 前端
  if (isDesktopTauri()) {
    console.log(t("log_sig_tauri_rust_reg"));
    
    // 監聽來自 Rust 的信令連線日誌，自動透過 interceptor 顯示於系統日誌
    listen<string>("rust-signaling-log", (event) => {
      console.log(event.payload);
    });

    // 監聽來自 Rust 的信令連線狀態更新，並同步更新 UI 狀態燈號
    listen<string>("rust-signaling-status", (event) => {
      const status = event.payload;
      const statusEl = document.getElementById("val-signaling-status");
      if (statusEl) {
        if (status === "connecting") {
          statusEl.className = "status-badge status-trial";
          statusEl.style.backgroundColor = "#fbbf24";
          statusEl.style.color = "#ffffff";
          statusEl.textContent = t("status_connecting") || "Connecting...";
        } else if (status === "online") {
          statusEl.className = "status-badge status-active";
          statusEl.style.backgroundColor = "";
          statusEl.style.color = "";
          statusEl.textContent = t("status_online") || "Online";
        } else {
          statusEl.className = "status-badge status-inactive";
          statusEl.style.backgroundColor = "";
          statusEl.style.color = "";
          statusEl.textContent = t("status_offline") || "Offline";
        }
      }
      
      if (status === "connecting") {
        console.log(t("log_sig_rust_trying"));
      } else if (status === "online") {
        console.log(t("log_sig_rust_connected"));
      } else if (status === "offline") {
        console.warn(t("log_sig_rust_disconnected"));
      }
    });

    // 監聽來自 Rust 的自訂日誌索取請求事件
    listen<string>("custom-request-logs-event", async (event) => {
      try {
        const payload = JSON.parse(event.payload);
        const source = payload.source;
        
        const logOverlay = document.getElementById("debug-overlay");
        const logsList: string[] = [];
        if (logOverlay) {
          Array.from(logOverlay.children).forEach((child) => {
            logsList.push(child.textContent || "");
          });
        }
        
        const responseMsg = JSON.stringify({
          type: "custom_response_logs",
          target: source,
          source: myId,
          logs: logsList.slice(-35)
        });
        
        await invoke("send_custom_signaling_message", { message: responseMsg });
        console.log(`[Diagnostic] 已成功將被控端除錯日誌透過 Rust 回傳給主控端 ${source}`);
      } catch (err) {
        console.error("處理自訂日誌索取請求失敗:", err);
      }
    });

    // 呼叫後端指令，傳入本機 ID 與當前 PIN 碼
    invoke("start_rust_signaling", { myId: myId, pin: "" })
      .then(() => {
        console.log(t("log_sig_rust_delegate_success"));
      })
      .catch((err) => {
        console.error(t("log_sig_rust_delegate_fail"), err);
      });
  } else {
    // 網頁瀏覽器控制端（Client）
    initSignalingClient();
  }
}

// 初始化行動端虛擬鍵盤拉起時的 Visual Viewport 避讓與對焦自適應


// 監聽 VisualViewport 以應對 iOS 鍵盤彈出與自適應縮放
if (window.visualViewport) {
  const isAndroid = /android/i.test(navigator.userAgent);

  // 注意：鍵盤彈出時的畫面平移已統一由 setupInputControl 內的 onViewportChange
  // 負責（焦點自適應上移、不壓縮畫面）。此處僅保留 iOS 的防滾動黑屏守衛，
  // 不再自行改寫 keyboardOffsetUpdateY，以免與其相互覆蓋、互打架。
  window.visualViewport.addEventListener("scroll", () => {
     const vv = window.visualViewport;
     // 防止 iOS 自動滾動整個頁面導致黑屏
     // Android uses native scroll, so we shouldn't block it.
     if (!isAndroid && vv && vv.offsetTop > 0) {
         window.scrollTo(0, 0);
     }
  });
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

