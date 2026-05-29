import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { listen } from "@tauri-apps/api/event";

function isDesktopTauri(): boolean {
  if (!isTauri()) return false;
  const ua = navigator.userAgent.toLowerCase();
  
  // 優先排除明確的行動端 UA 關鍵字
  const isMobileUA = /iphone|ipad|ipod|android|ios/.test(ua);
  if (isMobileUA) return false;
  
  // 防範 iPadOS / iOS 模擬 Mac 桌面網站 (觸控點大於 0 且支援 touch)
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (isTouchDevice) return false;
  
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

function applyVideoTransform() {
  const video = document.getElementById("remote-video") as HTMLVideoElement;
  if (!video) return;
  const finalY = videoTranslateY + keyboardOffsetUpdateY;
  video.style.transform = `translate(${videoTranslateX}px, ${finalY}px) scale(${videoScale})`;
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
let dataChannelFile: RTCDataChannel | null = null;
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
  // 為了確保 iOS 與 Mac mini 能夠順利連線，直接回傳公開部署的信令伺服器網址
  return OFFICIAL_SIGNALING_SERVER;
}

// STUN 伺服器清單（堅持不使用 TURN，避免未來營運成本）
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] }
];

// 宣告語系翻譯字典快取
let translations: Record<string, string> = {};
let isPinVisible = false;

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
  "btn_hide": "Hide"
};

// 統一翻譯取值函數
function t(key: string): string {
  return translations[key] || fallbackTranslations[key] || key;
}
(window as any).t = t; // Expose to global for console.error interceptor if needed

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
    const response = await fetch(`/locales/${lang}.json`);
    translations = await response.json();
    updateDomTranslations();
  } catch (error) {
    console.error(`無法載入語系檔 [${lang}]:`, error);
  }
}

// 更新 DOM 的文字內容
function updateDomTranslations() {
  // 更新所有對應的 DOM 元素
  setTextContent("txt-connect-title", t("connect_title"));
  setPlaceholder("remote-id-input", t("remote_id_placeholder"));
  setPlaceholder("access-pin-input", t("access_pin_placeholder"));
  setTextContent("txt-btn-connect", t("btn_connect"));
  setTextContent("txt-host-info-title", t("host_info_title"));
  setTextContent("lbl-remote-id", t("remote_id"));
  setTextContent("lbl-access-pin", t("access_pin_label"));
  setTextContent("lbl-my-pin", t("my_pin_label"));
  setTextContent("lbl-signaling-status", t("lbl_signaling_status"));
  setTextContent("lbl-my-id", t("my_id"));
  setTextContent("lbl-hwid", t("hwid"));
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

  setTextContent("txt-help-title", t("help_title"));
  setTextContent("txt-help-inst-title", t("help_inst_title"));
  setTextContent("txt-help-priv-title", t("help_priv_title"));
  setTextContent("txt-help-priv-desc", t("help_priv_desc"));
  
  const helpInstList = document.getElementById("txt-help-inst-list");
  if (helpInstList) {
    helpInstList.innerHTML = `
      <li>${t("help_inst_1")}</li>
      <li>${t("help_inst_2")}</li>
      <li>${t("help_inst_3")}</li>
    `;
  }

  // 新增右側面板的翻譯綁定
  setTextContent("txt-tools-title", t("tools_title"));
  setTextContent("txt-file-transfer-title", t("file_transfer_title"));
  setTextContent("txt-drop-zone", t("drop_zone"));
  setTextContent("btn-cancel-transfer", t("btn_cancel_transfer"));
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
  setTextContent("btn-verify-license", t("license_btn_verify"));
  setPlaceholder("license-input", t("license_placeholder"));

  // 智慧自動、效能卡片與說明區塊之對應翻譯
  setTextContent("lbl-smart-auto", t("smart_auto"));
  setTextContent("txt-auto-active", t("smart_auto_active_desc"));
  setTextContent("txt-sim-header", t("sim_advanced_header"));
  setTextContent("lbl-metric-rtt", t("metric_rtt"));
  setTextContent("lbl-metric-loss", t("metric_loss"));
  setTextContent("lbl-metric-protocol", t("metric_protocol"));
  setTextContent("lbl-metric-encryption", t("metric_encryption"));

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

// 產生本機隨機存取 PIN 碼（6 位數，每次啟動自動刷新）
function generateAccessPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 初始化存取 PIN 碼顯示與刷新邏輯
function initAccessPin() {
  const valPin = document.getElementById("val-my-pin");
  const btnRefresh = document.getElementById("btn-refresh-pin");
  const btnCopyPin = document.getElementById("btn-copy-pin");

  // 啟動時自動產生一組 PIN
  const freshPin = generateAccessPin();
  if (valPin) {
    valPin.textContent = `${freshPin.slice(0, 3)}-${freshPin.slice(3)}`;
  }
  // 儲存原始 PIN（不含 dash）供後端驗證用
  (window as any).__localAccessPin = freshPin;

  if (btnRefresh && valPin) {
    btnRefresh.addEventListener("click", () => {
      const newPin = generateAccessPin();
      valPin.textContent = `${newPin.slice(0, 3)}-${newPin.slice(3)}`;
      (window as any).__localAccessPin = newPin;
      myPin = newPin; // 同步更新全域變數，確保連線驗證時使用的是最新 PIN
      if (isDesktopTauri()) {
        invoke("update_rust_pin", { pin: newPin })
          .catch(err => console.error("Failed to update Rust pin:", err));
      }
      btnRefresh.textContent = "✓";
      setTimeout(() => { btnRefresh.textContent = "🔄"; }, 1000);
    });
  }

  if (btnCopyPin && valPin) {
    btnCopyPin.addEventListener("click", () => {
      const pinText = (window as any).__localAccessPin || myPin;
      navigator.clipboard.writeText(pinText).then(() => {
        btnCopyPin.textContent = "✓";
        setTimeout(() => { btnCopyPin.textContent = "📋"; }, 1500);
      });
    });
  }
}

// 初始化信令手動重連按鈕邏輯
function initSignalingReconnect() {
  const btnReconnect = document.getElementById("btn-reconnect-signaling");
  if (btnReconnect) {
    btnReconnect.addEventListener("click", () => {
      console.log("[Signaling] 使用者手動觸發信令重連...");
      btnReconnect.textContent = "✓";
      invoke("start_rust_signaling", { myId: myId, pin: myPin })
        .then(() => {
          setTimeout(() => { btnReconnect.textContent = "🔄"; }, 1000);
        })
        .catch((err) => {
          console.error("[Signaling] 重連失敗:", err);
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
  const inputPwd = document.getElementById("input-static-pwd") as HTMLInputElement;
  const statusSpan = document.getElementById("static-pwd-status");

  // 初始化時檢查是否已設定
  try {
    const hasPwd = await invoke("check_has_static_password");
    if (statusSpan) {
      statusSpan.textContent = hasPwd ? "Status: Set" : "Status: Not Set";
      statusSpan.style.color = hasPwd ? "var(--success-color, #2ecc71)" : "var(--text-muted)";
    }
  } catch (e) {
    console.warn("檢查固定密碼狀態失敗:", e);
  }

  if (btnSetPwd && inputPwd) {
    btnSetPwd.addEventListener("click", async () => {
      const pwd = inputPwd.value.trim();
      if (!pwd) {
        alert(t("alert_input_static_password"));
        return;
      }
      try {
        await invoke("set_static_password", { password: pwd });
        inputPwd.value = "";
        if (statusSpan) {
          statusSpan.textContent = "Status: Set";
          statusSpan.style.color = "var(--success-color, #2ecc71)";
        }
        showToast(t("toast_static_password_success"));
      } catch (e) {
        alert(t("alert_set_static_password_fail") + e);
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
  console.log(`[Signaling] 嘗試連線到信令伺服器: ${url}`);
  
  signalingWs = new WebSocket(url);
  
  signalingWs.onopen = () => {
    console.log("[Signaling] 已連線，正在登入...");
    signalingWs!.send(JSON.stringify({ type: "login", id: myId }));
    
    let lastHeartbeatTime = Date.now();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      // 若兩次心跳的實際時間間隔大於 25 秒，代表計時器曾被系統掛起（例如 macOS App Nap 或行動端背景休眠）
      if (now - lastHeartbeatTime > 25000) {
        console.warn("[Signaling] 偵測到計時器延遲（可能是系統 App Nap 凍結），主動關閉並重建連線...");
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
            console.log("[WebRTC] 遠端 Answer 已套用，ICE 協商中...");
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
    dataChannelFile = null;
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
    console.log(`[WebRTC] 連線狀態: ${state}`);
    updateConnectionStatusUI(state);
  };

  // 被動端：接收遠端建立的 Data Channels
  pc.ondatachannel = (event) => {
    const ch = event.channel;
    if (ch.label === "input-control") {
      dataChannelControl = ch;
      bindControlChannel(ch);
    } else if (ch.label === "file-transfer") {
      dataChannelFile = ch;
      bindFileChannel(ch);
    }
  };

  // 接收遠端視訊軌道 (只會在 iPhone / Client 端發生，因為 Mac 是 Host)
  pc.ontrack = (event) => {
    console.log("[WebRTC] 收到遠端視訊軌道:", event.track.kind);
    if (event.track.kind === "video") {
        // --- UI Setup ---
        const videoEl = document.getElementById("remote-video") as HTMLVideoElement;
        const videoContainer = document.getElementById("remote-video-container") as HTMLElement;
        const btnDisplayMode = document.getElementById("btn-display-mode") as HTMLButtonElement;
        const mainContent = document.querySelector(".glass-container") as HTMLElement;
        const btnKeyboard = document.getElementById("btn-mobile-keyboard") as HTMLButtonElement;
        
        if (videoContainer) videoContainer.style.display = "block";
        if (btnDisplayMode) btnDisplayMode.style.display = "block";
        if (mainContent) mainContent.style.display = "none";
        
        const mobileControlOrb = document.getElementById("mobile-control-orb");
        if (mobileControlOrb) mobileControlOrb.style.display = "flex";
        
        const mobileDial = document.getElementById("mobile-floating-dial");
        if (mobileDial) mobileDial.style.display = "block";
        
        // 如果是在手機/觸控環境上，顯示鍵盤呼叫按鈕
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
          btnKeyboard.style.display = "flex";
        }
        if (!videoEl.srcObject) {
          videoEl.srcObject = event.streams && event.streams.length > 0 
            ? event.streams[0] 
            : new MediaStream([event.track]);
            
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
              console.warn("[WebRTC] 連線已建立但偵測不到視訊播放 (黑屏)。可能是自動播放受限，或遠端 macOS 未授權螢幕錄製。");
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

    dataChannelFile = pc.createDataChannel("file-transfer", {
      ordered: true,    // 可靠傳輸，確保檔案完整
    });
    bindFileChannel(dataChannelFile);

    // 要求接收視訊軌道 (加入 m=video 至 SDP Offer)
    pc.addTransceiver("video", { direction: "recvonly" });

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

  console.log(`[WebRTC] Offer 已發送至 ${remoteId}`);
}

// 被動端：收到 Offer，驗證 PIN 後回傳 Answer
async function handleIncomingOffer(sourceId: string, sdpString: string, incomingPin?: string) {
  // 1. 檢查本機授權狀態（作為被控端，必須有有效授權或在試用期內）
  try {
    const isWebBrowser = !isDesktopTauri();
    if (!isWebBrowser) {
      const licenseState = await invoke<{status: string, trial_days_left: number | null}>("check_license_status");
      if (licenseState.status === "expired" || licenseState.status === "unauthorized") {
        console.warn(`[WebRTC] 拒絕連線：被控端試用期已過期 (${licenseState.status})`);
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

  // 2. 驗證 PIN 碼 (雙軌制：檢查隨機 PIN 或 固定密碼)
  let isStaticValid = false;
  if (incomingPin && incomingPin !== myPin) {
    try {
      isStaticValid = await invoke("verify_static_password", { password: incomingPin });
    } catch (e) {
      console.warn("驗證固定密碼時發生錯誤:", e);
    }
  }

  if (incomingPin !== myPin && !isStaticValid) {
    console.warn(`[WebRTC] 拒絕連線：PIN 碼不符`);
    if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
      signalingWs.send(JSON.stringify({
        type: "error",
        target: sourceId,
        message: "Connection rejected: Invalid PIN or Password"
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

// 檔案傳輸通道綁定
function bindFileChannel(ch: RTCDataChannel) {
  ch.binaryType = "arraybuffer";
  ch.onopen = () => console.log("[DataChannel] file-transfer 已開啟");
  ch.onclose = () => console.log("[DataChannel] file-transfer 已關閉");
  ch.onmessage = async (event) => {
    // 接收端收到檔案資料塊 — 交由 Rust 寫入磁碟
    try {
      const data = new Uint8Array(event.data as ArrayBuffer);
      await invoke("receive_file_chunk", { chunk: Array.from(data) });
    } catch (e) {
      console.error("[File] 寫入檔案塊失敗:", e);
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
  const btnKeyboard = document.getElementById("btn-mobile-keyboard") as HTMLButtonElement;
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
  if (btnKeyboard) {
    btnKeyboard.style.display = "none";
  }
  
  const mobileControlOrb = document.getElementById("mobile-control-orb");
  if (mobileControlOrb) {
    mobileControlOrb.style.display = "none";
  }

  // 重置顯示模式狀態與隱藏懸浮手勢工具輪
  resetDisplayMode();
  const mobileDial = document.getElementById("mobile-floating-dial");
  if (mobileDial) {
    mobileDial.style.display = "none";
  }
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

    console.log(`[Frontend] 發起 WebRTC 連線至 ${remoteId} (PIN: ${pin})`);
    // 真正的 WebRTC 連線發起
    await startCall(remoteId, pin);
  });
}


// 授權金鑰驗證
async function initLicenseVerification() {
  const btnVerify = document.getElementById("btn-verify-license");
  const licenseInput = document.getElementById("license-input") as HTMLInputElement;
  const statusBadge = document.getElementById("license-status");

  // 判斷是否在純網頁環境（例如手機瀏覽器）
  const isWebBrowser = !isDesktopTauri();

  if (isWebBrowser) {
    if (statusBadge) {
      statusBadge.className = "status-badge status-active";
      statusBadge.textContent = "Web Client";
    }
    if (licenseInput) licenseInput.setAttribute("disabled", "true");
    if (btnVerify) btnVerify.setAttribute("disabled", "true");
    console.log("[license] 純網頁環境，跳過本機授權檢查");
    return;
  }

  // 啟動時自動檢查 Keychain 中是否已有合法授權或試用狀態
  if (statusBadge) {
    try {
      const licenseState = await invoke<{status: string, trial_days_left: number | null}>("check_license_status");
      
      if (licenseState.status === "buyout") {
        statusBadge.className = "status-badge status-active";
        statusBadge.textContent = t("status_active");
        console.log("[license] 啟動時偵測到有效授權，已恢復狀態");
      } else if (licenseState.status === "trial") {
        statusBadge.className = "status-badge status-active"; // Use active style for trial so it looks green/yellow, maybe add a warning style later
        statusBadge.style.backgroundColor = "#eab308"; // Tailwind yellow-500
        statusBadge.style.color = "#ffffff";
        statusBadge.textContent = (t("status_trial") || "Trial ({0} days left)").replace("{0}", String(licenseState.trial_days_left));
        console.log(`[license] 試用期內，剩餘天數: ${licenseState.trial_days_left}`);
      } else if (licenseState.status === "expired") {
        statusBadge.className = "status-badge status-inactive";
        statusBadge.textContent = t("status_expired") || "Trial Expired";
        console.log("[license] 試用已過期");
      } else {
        statusBadge.className = "status-badge status-inactive";
        statusBadge.textContent = t("status_inactive");
      }
    } catch (e) {
      console.warn("[license] 啟動授權檢查失敗:", e);
    }
  }

  if (btnVerify && licenseInput && statusBadge) {
    btnVerify.addEventListener("click", async () => {
      const key = licenseInput.value.trim();
      if (!key) {
        alert(t("err_license_empty"));
        return;
      }

      try {
        const isValid = await invoke<boolean>("verify_license_key", { licenseKey: key });
        if (isValid) {
          statusBadge.className = "status-badge status-active";
          statusBadge.textContent = t("status_active");
          alert(t("alert_license_success"));
        } else {
          statusBadge.className = "status-badge status-inactive";
          statusBadge.textContent = t("status_inactive");
          alert(t("alert_license_fail"));
        }
      } catch (error) {
        const errorStr = String(error);
        let displayError = errorStr;
        
        if (errorStr.startsWith("err_limit_exceeded|")) {
          const parts = errorStr.split("|");
          const rawHwids = parts[1] || "";
          const template = t("err_limit_exceeded");
          displayError = template.replace("{0}", rawHwids);
        } else if (errorStr.startsWith("err_cooldown_active|")) {
          const parts = errorStr.split("|");
          const seconds = parts[1] || "10";
          const template = t("err_cooldown_active");
          displayError = template.replace("{0}", seconds);
        } else if (errorStr.startsWith("err_connect_server|")) {
          const parts = errorStr.split("|");
          const details = parts.slice(1).join("|");
          displayError = t("err_connect_server") + details;
        } else {
          displayError = t(errorStr);
        }
        
        alert(`${t("alert_license_error")}${displayError}`);
      }
    });
  }
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
  if (!isDesktopTauri()) return;
  setInterval(async () => {
    try {
      const status = await invoke<any>("get_connection_status");
      
      setTextContent("val-metric-fps", `${status.target_fps} fps`);
      
      const colorText = t(status.color_format);
      setTextContent("val-metric-color", colorText);
      
      setTextContent("val-metric-bitrate", `${(status.bitrate_limit_kbps / 1000).toFixed(1)} Mbps`);
      
      const fileText = status.file_transfer_enabled
        ? t("file_enabled")
        : t("file_disabled");
        
      setTextContent("val-metric-file", fileText);

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
        dataChannelFile = pc.createDataChannel("file-transfer", { ordered: true });
        bindFileChannel(dataChannelFile);

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
          if (event.channel.label === "file-transfer") bindFileChannel(event.channel);
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
            if (event.channel.label === "file-transfer") bindFileChannel(event.channel);
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

// 初始化一鍵複製功能 (本機 ID / HWID) 並加上微交互回饋
function initClipboardCopy() {
  const btnCopyId = document.getElementById("btn-copy-id");
  const btnCopyHwid = document.getElementById("btn-copy-hwid");
  const valMyId = document.getElementById("val-my-id");
  const valHwid = document.getElementById("val-hwid");

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

function setupInputControl(videoEl: HTMLVideoElement) {
  if (inputBound) return;
  inputBound = true;

  // --- 邊緣平移與顯示模式狀態 ---
  let displayMode: "fit" | "original" | "fill" = "fit";
  let panRafId: number | null = null;
  currentCursorPercentX = 0.5;
  currentCursorPercentY = 0.5;
  const videoContainer = document.getElementById("remote-video-container") as HTMLElement;
  const btnDisplayMode = document.getElementById("btn-display-mode") as HTMLButtonElement;
  const btnKeyboard = document.getElementById("btn-mobile-keyboard") as HTMLButtonElement;
  const hiddenInput = document.getElementById("hidden-keyboard-input") as HTMLTextAreaElement;
  let isKeyboardActive = false;
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

  if (btnDisplayMode) {
    btnDisplayMode.textContent = "🔍 " + t("btn_original_size");
    btnDisplayMode.onclick = () => {
      if (displayMode === "fit") {
        displayMode = "original";
      } else if (displayMode === "original") {
        displayMode = "fill";
      } else {
        displayMode = "fit";
      }
      applyDisplayMode();
    };
  }

  function startEdgePanLoop() {
    if (panRafId !== null) return;
    const loop = () => {
      if (!videoContainer) return;
      
      const edgeThreshold = 0.08; // 游標接近邊緣 8%
      const panSpeed = 15;       // 平移速度 (px/frame)
      
      let dx = 0;
      let dy = 0;
      
      if (currentCursorPercentX < edgeThreshold) {
        dx = -panSpeed;
      } else if (currentCursorPercentX > 1.0 - edgeThreshold) {
        dx = panSpeed;
      }
      
      if (currentCursorPercentY < edgeThreshold) {
        dy = -panSpeed;
      } else if (currentCursorPercentY > 1.0 - edgeThreshold) {
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
      }
      
      panRafId = requestAnimationFrame(loop);
    };
    panRafId = requestAnimationFrame(loop);
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
    if (moveRafActive) return;
    moveRafActive = true;
    requestAnimationFrame(sendPendingMoves);
  }

  function sendPendingMoves() {
    moveRafActive = false;
    
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
        }, 15);
      }, 50);
    }, 15);
  };
  let initialPinchDistance = -1;
  let maxTouches = 0;
  let isLocalPinching = false;

  let pinchStartScale = 1.0;
  let pinchStartTx = 0;
  let pinchStartTy = 0;
  let pinchStartCx = 0;
  let pinchStartCy = 0;

  // 觸控模式 (絕對觸控 vs 虛擬軌跡板)
  let isDirectTouchMode = false; // 預設為軌跡板模式
  let longPressTimer: any = null;
  let touchStartClientX = 0;
  let touchStartClientY = 0;
  let hasTriggeredLongPress = false;

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
  const SCROLL_DECAY = 0.92;
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
    if (absDelta < 2) {
      multiplier = 0.8;
    } else if (absDelta < 8) {
      multiplier = 0.8 + ((absDelta - 2) / 6) * 1.7;
    } else {
      multiplier = 2.5 + (absDelta - 8) * 0.08;
    }
    return delta * multiplier;
  }

  function updateCursorOverlay(percentX: number, percentY: number) {
    const cursorEl = document.getElementById("remote-cursor");
    if (!cursorEl || isDirectTouchMode) return;
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
    cursorEl.style.display = "block";
    cursorEl.style.left = pixelX + "px";
    cursorEl.style.top = pixelY + "px";
  }

  // 初始化懸浮選單與 Toggle 切換按鈕
  const mobileControlOrb = document.getElementById("mobile-control-orb");
  if (mobileControlOrb) {
    mobileControlOrb.style.display = "flex";
  }

  // 藥丸型手把折疊事件綁定
  const controlToggle = document.getElementById("btn-control-toggle");
  const controlPanel = document.getElementById("control-dock-panel");
  const toggleArrow = document.getElementById("control-toggle-arrow");
  let isPanelOpen = false;
  
  if (controlToggle && controlPanel && toggleArrow) {
    controlToggle.onclick = (e) => {
      e.stopPropagation();
      isPanelOpen = !isPanelOpen;
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

  const btnTouchMode = document.getElementById("btn-touch-mode") as HTMLButtonElement;
  if (btnTouchMode) {
    btnTouchMode.onclick = () => {
      isDirectTouchMode = !isDirectTouchMode;
      if (isDirectTouchMode) {
        btnTouchMode.textContent = "👆 Direct Touch";
        // 絕對觸控模式下隱藏本地游標
        const cursorEl = document.getElementById("remote-cursor");
        if (cursorEl) cursorEl.style.display = "none";
      } else {
        btnTouchMode.textContent = "🖱️ Trackpad Mode";
      }
    };
  }

  function getPinchDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // --- 滑鼠事件對應 (Pointer Lock 模式) ---
  videoEl.addEventListener("pointermove", (e) => {
    e.preventDefault();
    if (e.pointerType === "touch" || e.pointerType === "pen") return; // 由觸控手勢處理
    
    if (document.pointerLockElement === videoEl) {
      pendingRelativeDX += Math.round(e.movementX);
      pendingRelativeDY += Math.round(e.movementY);
      triggerMoveRaf();
      currentCursorPercentX = 0.5;
      currentCursorPercentY = 0.5;
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
      
      const mouseSpeed = Math.sqrt(e.movementX * e.movementX + e.movementY * e.movementY) / (videoContainer.clientWidth || 1);
      const snapped = applySmartSnapping(x, y, mouseSpeed);
      x = snapped.x;
      y = snapped.y;
      
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
      updateCursorOverlay(x, y);
    }
  });

  videoEl.addEventListener("pointerleave", () => {
    // 移出時終止邊緣平移
    currentCursorPercentX = 0.5;
    currentCursorPercentY = 0.5;
  });

  videoEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") return;
    e.preventDefault();
    
    // 點擊畫面時，如果尚未處於鎖定狀態，且為實實滑鼠點擊，嘗試鎖定滑鼠
    if (document.pointerLockElement !== videoEl) {
      videoEl.requestPointerLock();
    }
    
    const payload = new Uint8Array(1);
    let btn = 1;
    if (e.button === 2) btn = 2;
    if (e.button === 1) btn = 3;
    payload[0] = btn;
    sendInputPacket(buildInputPacket(0x02, payload));
  });

  // 監聽 Pointer Lock 變更
  document.addEventListener("pointerlockchange", () => {
    const tooltip = document.getElementById("pointer-lock-tooltip");
    if (document.pointerLockElement === videoEl) {
      console.log("[Pointer Lock] 滑鼠指標已鎖定");
      if (tooltip) {
        tooltip.style.display = "block";
        tooltip.style.opacity = "1";
        // 3 秒後漸隱
        setTimeout(() => {
          if (document.pointerLockElement === videoEl) {
            tooltip.style.opacity = "0";
            setTimeout(() => {
              if (document.pointerLockElement === videoEl && tooltip.style.opacity === "0") {
                tooltip.style.display = "none";
              }
            }, 300);
          }
        }, 3000);
      }
      
      // 啟用 Keyboard Lock (系統快捷鍵攔截)
      if ((navigator as any).keyboard && typeof (navigator as any).keyboard.lock === "function") {
        (navigator as any).keyboard.lock(["Escape", "Tab", "MetaLeft", "MetaRight", "AltLeft", "AltRight"])
          .then(() => console.log("[Keyboard Lock] 鍵盤鎖定成功"))
          .catch((err: any) => console.warn("[Keyboard Lock] 鍵盤鎖定失敗:", err));
      }
    } else {
      console.log("[Pointer Lock] 滑鼠指標已解鎖");
      if (tooltip) {
        tooltip.style.display = "none";
        tooltip.style.opacity = "0";
      }
      
      // 解除 Keyboard Lock
      if ((navigator as any).keyboard && typeof (navigator as any).keyboard.unlock === "function") {
        (navigator as any).keyboard.unlock();
        console.log("[Keyboard Lock] 鍵盤鎖定解除");
      }
      
      // 重置邊緣平移座標
      currentCursorPercentX = 0.5;
      currentCursorPercentY = 0.5;
    }
  });

  // 快速鍵下拉選單切換與複合按鍵發送
  const btnSendKeys = document.getElementById("btn-send-keys");
  const shortcutsDropdown = document.getElementById("shortcuts-dropdown");
  if (btnSendKeys && shortcutsDropdown) {
    btnSendKeys.onclick = (e) => {
      e.stopPropagation();
      const isVisible = shortcutsDropdown.style.display === "flex";
      shortcutsDropdown.style.display = isVisible ? "none" : "flex";
    };

    // 點擊選單外部時，隱藏選單
    document.addEventListener("click", () => {
      if (shortcutsDropdown.style.display === "flex") {
        shortcutsDropdown.style.display = "none";
      }
    });

    // 阻止選單內部點擊冒泡
    shortcutsDropdown.onclick = (e) => {
      e.stopPropagation();
    };

    // 下拉選單項目的 hover 效果與點擊事件
    const shortcutItems = shortcutsDropdown.querySelectorAll(".shortcut-item");
    shortcutItems.forEach((item) => {
      const btnItem = item as HTMLButtonElement;
      
      btnItem.onmouseenter = () => {
        btnItem.style.background = "rgba(255, 255, 255, 0.15)";
      };
      btnItem.onmouseleave = () => {
        btnItem.style.background = "none";
      };

      btnItem.onclick = () => {
        const keys = btnItem.getAttribute("data-keys");
        if (keys) {
          sendShortcut(keys);
        }
        shortcutsDropdown.style.display = "none";
      };
    });
  }

  // 輔助函數：發送複合快捷鍵
  function sendShortcut(keys: string) {
    const ctrlCode = 17;
    const altCode = 18;
    const delCode = 46;
    const winCode = 91;
    const tabCode = 9;
    const escCode = 27;

    const pressKey = (code: number, mods: number = 0) => {
      const payload = new Uint8Array(3);
      const view = new DataView(payload.buffer);
      view.setUint16(0, code, false);
      payload[2] = mods;
      sendInputPacket(buildInputPacket(0x05, payload));
    };

    const releaseKey = (code: number, mods: number = 0) => {
      const payload = new Uint8Array(3);
      const view = new DataView(payload.buffer);
      view.setUint16(0, code, false);
      payload[2] = mods;
      sendInputPacket(buildInputPacket(0x06, payload));
    };

    if (keys === "ctrl-alt-del") {
      // 複合鍵順序：Ctrl Down -> Alt Down -> Del Down -> Del Up -> Alt Up -> Ctrl Up
      pressKey(ctrlCode, 2);
      pressKey(altCode, 6);
      pressKey(delCode, 6);
      setTimeout(() => {
        releaseKey(delCode, 6);
        releaseKey(altCode, 2);
        releaseKey(ctrlCode, 0);
      }, 50);
    } else if (keys === "win") {
      pressKey(winCode, 8);
      setTimeout(() => {
        releaseKey(winCode, 0);
      }, 50);
    } else if (keys === "alt-tab") {
      pressKey(altCode, 4);
      pressKey(tabCode, 4);
      setTimeout(() => {
        releaseKey(tabCode, 4);
        releaseKey(altCode, 0);
      }, 50);
    } else if (keys === "ctrl-esc") {
      pressKey(ctrlCode, 2);
      pressKey(escCode, 2);
      setTimeout(() => {
        releaseKey(escCode, 2);
        releaseKey(ctrlCode, 0);
      }, 50);
    }
  }

  videoEl.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") return;
    e.preventDefault();
    const payload = new Uint8Array(1);
    let btn = 1;
    if (e.button === 2) btn = 2;
    if (e.button === 1) btn = 3;
    payload[0] = btn;
    sendInputPacket(buildInputPacket(0x03, payload));
  });

  // --- 手勢辨識與狀態機 ---
  videoEl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    maxTouches = Math.max(maxTouches, e.touches.length);
    stopMomentum();
    stopScrollMomentum();
    
    if (e.touches.length === 2) {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
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
    } else if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      const now = Date.now();
      
      touchStartTime = now;
      touchStartPos = { x: lastTouchX, y: lastTouchY };
      touchStartClientX = lastTouchX;
      touchStartClientY = lastTouchY;
      hasTriggeredLongPress = false;

      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        hasTriggeredLongPress = true;
        
        if (isDragging) {
          const payloadLeftUp = new Uint8Array(1);
          payloadLeftUp[0] = 1; // Left click release
          sendInputPacket(buildInputPacket(0x03, payloadLeftUp));
          isDragging = false;
        }

        // 發送右鍵按下與放開
        const payloadDown = new Uint8Array(1);
        payloadDown[0] = 2; // Right click down
        sendInputPacket(buildInputPacket(0x02, payloadDown));
        
        const payloadUp = new Uint8Array(1);
        payloadUp[0] = 2; // Right click up
        sendInputPacket(buildInputPacket(0x03, payloadUp));
        
        triggerHaptic("heavy");
        console.log("[Gesture] 單指長按，觸發右鍵點擊與震動");
      }, 400);
      
      if (isDirectTouchMode) {
        // Direct Touch 模式：不在此立即發送 MouseDown，而是採取 Lazy Drag 延遲拖曳
        isDragging = false;
      } else {
        if (now - lastTapTime < 300) {
          // 雙擊拖曳
          isDragging = true;
          const payload = new Uint8Array(1);
          payload[0] = 1;
          sendInputPacket(buildInputPacket(0x02, payload));
        } else {
          isDragging = false;
        }
      }
    }
  }, { passive: false });

  videoEl.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      const currentDistance = getPinchDistance(e.touches);
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
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
        return;
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
        let x = (currentX - rect.left - offsetX) / renderedWidth;
        let y = (currentY - rect.top - offsetY) / renderedHeight;
        x = Math.max(0, Math.min(1, x));
        y = Math.max(0, Math.min(1, y));
        
        // 計算速度以決定是否磁吸
        const touchSpeed = lastTouchX !== 0 && lastTouchY !== 0 
          ? Math.sqrt(Math.pow(currentX - lastTouchX, 2) + Math.pow(currentY - lastTouchY, 2)) / renderedWidth
          : 0;
        const snapped = applySmartSnapping(x, y, touchSpeed);
        x = snapped.x;
        y = snapped.y;
        
        // Tremor Suppression (防手震) & Lazy Drag (延遲拖曳激活)
        if (!isDragging) {
          const startDist = Math.sqrt(Math.pow(currentX - touchStartPos.x, 2) + Math.pow(currentY - touchStartPos.y, 2));
          if (startDist > 10 || Date.now() - touchStartTime > 200) {
            isDragging = true;
            // 首次啟動拖曳：先發送滑鼠移動到起點，再發送滑鼠按下
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
        }
        
        if (isDragging) {
          pendingMouseMoveX = x;
          pendingMouseMoveY = y;
          triggerMoveRaf();

          currentCursorPercentX = x;
          currentCursorPercentY = y;
        }
      } else {
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
          
          // 計算速度以決定是否磁吸
          const touchSpeed = Math.sqrt(accDx * accDx + accDy * accDy) / renderedWidth;
          const snapped = applySmartSnapping(trackpadCursorX, trackpadCursorY, touchSpeed);
          
          pendingMouseMoveX = snapped.x;
          pendingMouseMoveY = snapped.y;
          triggerMoveRaf();

          updateCursorOverlay(snapped.x, snapped.y);

          const now = performance.now();
          const dt = now - lastMoveTimestamp;
          if (dt > 0 && dt < 100) {
            momentumVx = (accDx / renderedWidth) * (16 / dt);
            momentumVy = (accDy / renderedHeight) * (16 / dt);
          }
          lastMoveTimestamp = now;

          currentCursorPercentX = snapped.x;
          currentCursorPercentY = snapped.y;
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

    // 雙指輕觸判定優化：只要在 350ms 內偵測到 maxTouches === 2，且未發生大範圍縮放，在第一根手指抬起時即刻觸發右鍵
    if (maxTouches === 2) {
      if (touchStartTime > 0 && now - touchStartTime < 350 && !isLocalPinching) {
        // 雙指輕觸 -> 右鍵點擊 (發送 Down 與 Up 之間加入 15ms 延遲，以防 macOS 忽略同網路包連續點擊)
        const payloadDown = new Uint8Array(1);
        payloadDown[0] = 2; // Right click down
        sendInputPacket(buildInputPacket(0x02, payloadDown));
        
        setTimeout(() => {
          const payloadUp = new Uint8Array(1);
          payloadUp[0] = 2; // Right click up
          sendInputPacket(buildInputPacket(0x03, payloadUp));
          console.log("[Gesture] 雙指輕點，15ms 延遲發送右鍵釋送完成");
        }, 15);
        
        console.log("[Gesture] 雙指輕點，觸發右鍵按下");
        
        triggerHaptic("heavy");
      }
      
      if (!isLocalPinching && (Math.abs(scrollVx) > SCROLL_MIN_VELOCITY || Math.abs(scrollVy) > SCROLL_MIN_VELOCITY)) {
        startScrollMomentum();
      }

      // 重置雙指狀態，防範後續多重觸發
      maxTouches = 0;
      touchStartTime = 0;
      initialPinchDistance = -1;
      return;
    }
    
    if (e.touches.length === 0) {
      if (isKeyboardActive && hiddenInput && document.activeElement !== hiddenInput) {
        hiddenInput.focus();
      }
      // 抬起手指時，立刻重置邊緣平移
      currentCursorPercentX = 0.5;
      currentCursorPercentY = 0.5;
      
      if (hasTriggeredLongPress) {
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
        } else {
          // 直控模式單指輕觸 -> 左鍵點擊 (15ms 延遲確保雙平台相容)
          // 智慧雙擊判定
          const tapDist = Math.sqrt(Math.pow(endX - lastTapPos.x, 2) + Math.pow(endY - lastTapPos.y, 2));
          if (now - lastTapTime < 300 && tapDist < 15) {
            // 智慧雙擊序列
            sendDoubleClickSequence();
            lastTapTime = 0;
          } else {
            // 單點
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
              console.log("[Gesture-Direct] 單指輕點完成");
            }, 15);
            
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
        } else {
          // 軌跡板模式單指輕觸 -> 左鍵點擊 (15ms 延遲確保雙平台相容)
          if (touchStartTime > 0 && now - touchStartTime < 350 && maxTouches === 1) {
            const dist = Math.sqrt(Math.pow(endX - touchStartPos.x, 2) + Math.pow(endY - touchStartPos.y, 2));
            if (dist < 20) {
              const tapDist = Math.sqrt(Math.pow(endX - lastTapPos.x, 2) + Math.pow(endY - lastTapPos.y, 2));
              if (now - lastTapTime < 300 && tapDist < 15) {
                // 智慧雙擊序列
                sendDoubleClickSequence();
                lastTapTime = 0;
              } else {
                // 單點
                const payloadDown = new Uint8Array(1);
                payloadDown[0] = 1;
                sendInputPacket(buildInputPacket(0x02, payloadDown));
                triggerHaptic("light");
                setTimeout(() => {
                  const payloadUp = new Uint8Array(1);
                  payloadUp[0] = 1;
                  sendInputPacket(buildInputPacket(0x03, payloadUp));
                  console.log("[Gesture-Trackpad] 單指輕點完成");
                }, 15);
                
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
    
    const payloadLeft = new Uint8Array(1);
    payloadLeft[0] = 1;
    sendInputPacket(buildInputPacket(0x03, payloadLeft));

    const payloadRight = new Uint8Array(1);
    payloadRight[0] = 2;
    sendInputPacket(buildInputPacket(0x03, payloadRight));

    isDragging = false;
    initialPinchDistance = -1;
    touchStartTime = 0;
    lastTouchX = 0;
    lastTouchY = 0;
    maxTouches = 0;
  }, { passive: false });

  videoEl.addEventListener("contextmenu", (e) => e.preventDefault());

  videoEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const payload = new Uint8Array(4);
    const view = new DataView(payload.buffer);
    const dx = Math.round(e.deltaX * -1); 
    const dy = Math.round(e.deltaY * -1);
    
    view.setInt16(0, dx, false);
    view.setInt16(2, dy, false);
    sendInputPacket(buildInputPacket(0x04, payload)); // 0x04 is MouseScroll
  }, { passive: false });

  // 攔截鍵盤輸入
  window.addEventListener("keydown", (e) => {
    if (videoEl.style.display === "none") return;
    if (document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT") {
      // 正在輸入欄位時，不要攔截鍵盤事件，交由輸入法與虛擬鍵盤處理
      return;
    }
    
    e.preventDefault(); 
    
    const payload = new Uint8Array(3);
    const view = new DataView(payload.buffer);
    
    let keyCode = e.keyCode;
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

  const handleBackspace = () => {
    const now = Date.now();
    if (now - lastBackspaceTime > 100) {
      lastBackspaceTime = now;
      sendKeyStroke(8);
    }
    if (hiddenInput) {
      hiddenInput.value = "   ";
    }
    lastValue = "   ";
  };

  const handleEnter = () => {
    sendKeyStroke(13);
    if (hiddenInput) {
      hiddenInput.value = "   ";
    }
    lastValue = "   ";
  };

  if (btnKeyboard && hiddenInput) {
    btnKeyboard.addEventListener("click", (e) => {
      e.stopPropagation();
      isKeyboardActive = true;
      hiddenInput.value = "   ";
      lastValue = "   ";
      hiddenInput.focus();
    });

    hiddenInput.addEventListener("blur", () => {
      isKeyboardActive = false;
      hiddenInput.value = "";
      lastValue = "";
    });

    hiddenInput.addEventListener("compositionstart", () => {
      isComposing = true;
      const previewBox = document.getElementById("keyboard-preview-box");
      if (previewBox) {
        previewBox.style.display = "block";
        const previewText = document.getElementById("keyboard-preview-text");
        if (previewText) previewText.textContent = "";
      }
    });

    hiddenInput.addEventListener("compositionupdate", (e: any) => {
      const previewBox = document.getElementById("keyboard-preview-box");
      const previewText = document.getElementById("keyboard-preview-text");
      const container = document.getElementById("remote-video-container");
      if (previewBox && previewText && container && e.data) {
        previewText.textContent = e.data;
        // 定位在全域游標百分比 Y 與 X 上方 55 像素，置中對齊
        const posX = currentCursorPercentX * container.clientWidth;
        const posY = currentCursorPercentY * container.clientHeight - 55;
        previewBox.style.left = `${posX}px`;
        previewBox.style.top = `${posY}px`;
        previewBox.style.transform = "translateX(-50%)";
      }
    });

    hiddenInput.addEventListener("compositionend", () => {
      isComposing = false;
      const previewBox = document.getElementById("keyboard-preview-box");
      if (previewBox) previewBox.style.display = "none";
      // 延遲以確保某些行動端瀏覽器在 compositionend 觸發時 value 已完全寫入
      setTimeout(() => {
        const val = hiddenInput.value;
        const cleanVal = val.startsWith("   ") ? val.slice(3) : val;
        if (cleanVal.length > 0) {
          const encoder = new TextEncoder();
          const payload = encoder.encode(cleanVal);
          sendInputPacket(buildInputPacket(0x08, payload));
        }
        hiddenInput.value = "   ";
        lastValue = "   ";
      }, 10);
    });

    hiddenInput.addEventListener("input", (e: Event) => {
      if (isComposing) return;

      const currentValue = hiddenInput.value;

      // 1. 偵測換行 (Enter 鍵)
      if (currentValue.includes("\n") || currentValue.includes("\r")) {
        handleEnter();
        return;
      }

      // 2. 當長度少於預置的 3 個空格時，判定為 Backspace 刪除
      if (currentValue.length < 3) {
        const deleteCount = 3 - currentValue.length;
        for (let i = 0; i < deleteCount; i++) {
          sendKeyStroke(8);
        }
        hiddenInput.value = "   ";
        lastValue = "   ";
        return;
      }

      // 3. 當長度大於 3 個空格時，判定為正常輸入字元或中文貼上，提取增量
      if (currentValue.length > 3) {
        const added = currentValue.slice(3);
        if (added.length > 0) {
          const encoder = new TextEncoder();
          const payload = encoder.encode(added);
          sendInputPacket(buildInputPacket(0x08, payload));
        }
        hiddenInput.value = "   ";
        lastValue = "   ";
      }
    });
  }

  // 點擊視訊畫面時的防失焦重新 Focus 處理
  videoEl.addEventListener("click", () => {
    if (isKeyboardActive && hiddenInput && document.activeElement !== hiddenInput) {
      hiddenInput.focus();
    }
  });

  // 監聽失去焦點與頁面隱藏事件，清空 Host 卡死按鍵
  const onResetTrigger = () => {
    if (videoEl.style.display !== "none") {
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

  // =========================================================================
  // 仿 iOS AssistiveTouch 智能圓形懸浮控制轉盤 JS 實作
  // =========================================================================
  const dialContainer = document.getElementById("mobile-floating-dial") as HTMLElement;
  const dialTrigger = document.getElementById("mobile-floating-dial-trigger") as HTMLElement;
  let isDialExpanded = false;
  let isDraggingDial = false;
  let dialStartX = 0;
  let dialStartY = 0;
  let dialLeft = 12; // 初始靠左
  let dialTop = window.innerHeight / 2 - 25; // 垂直置中

  const expandDial = (side: "left" | "right") => {
    isDialExpanded = true;
    if (dialContainer && dialTrigger) {
      dialContainer.classList.add("expanded");
      dialTrigger.classList.add("active");
      dialTrigger.classList.remove("pulse");
    }
    
    // 子按鈕角度定義
    const leftOffsets = [
      { x: 42, y: -72 },  // Keyboard
      { x: 74, y: -40 },  // Mode
      { x: 84, y: 0 },    // Display
      { x: 74, y: 40 },   // Shortcuts
      { x: 42, y: 72 }    // Logs
    ];
    
    const rightOffsets = [
      { x: -42, y: -72 },
      { x: -74, y: -40 },
      { x: -84, y: 0 },
      { x: -74, y: 40 },
      { x: -42, y: 72 }
    ];
    
    const offsets = side === "left" ? leftOffsets : rightOffsets;
    const items = dialContainer.querySelectorAll(".dial-item");
    items.forEach((item, index) => {
      const htmlItem = item as HTMLElement;
      htmlItem.style.setProperty("--tx", `${offsets[index].x}px`);
      htmlItem.style.setProperty("--ty", `${offsets[index].y}px`);
    });
  };

  const collapseDial = () => {
    isDialExpanded = false;
    if (dialContainer && dialTrigger) {
      dialContainer.classList.remove("expanded");
      dialTrigger.classList.remove("active");
      dialTrigger.classList.add("pulse");
    }
  };

  // 曝露給全域以供連線重置時調用
  resetDisplayMode = () => {
    displayMode = "fit";
    applyDisplayMode();
    collapseDial();
  };

  if (dialContainer && dialTrigger) {
    // 設定初始位置
    dialContainer.style.left = `${dialLeft}px`;
    dialContainer.style.top = `${dialTop}px`;
    
    dialTrigger.addEventListener("touchstart", (e) => {
      e.stopPropagation();
      isDraggingDial = false;
      const touch = e.touches[0];
      dialStartX = touch.clientX - dialLeft;
      dialStartY = touch.clientY - dialTop;
      
      if (isDialExpanded) {
        collapseDial();
      }
    }, { passive: true });
    
    dialTrigger.addEventListener("touchmove", (e) => {
      e.stopPropagation();
      isDraggingDial = true;
      const touch = e.touches[0];
      let newLeft = touch.clientX - dialStartX;
      let newTop = touch.clientY - dialStartY;
      
      // 限制在螢幕可見範圍內 (保留 12px 邊緣安全區)
      newLeft = Math.max(12, Math.min(window.innerWidth - 50 - 12, newLeft));
      newTop = Math.max(12, Math.min(window.innerHeight - 50 - 12, newTop));
      
      dialLeft = newLeft;
      dialTop = newTop;
      dialContainer.style.left = `${dialLeft}px`;
      dialContainer.style.top = `${dialTop}px`;
    }, { passive: true });
    
    dialTrigger.addEventListener("touchend", (e) => {
      e.stopPropagation();
      if (!isDraggingDial) {
        // 單擊展開/收合
        if (isDialExpanded) {
          collapseDial();
        } else {
          const centerPoint = window.innerWidth / 2;
          const side = (dialLeft + 25 < centerPoint) ? "left" : "right";
          expandDial(side);
        }
      } else {
        // 貼邊磁吸
        const centerPoint = window.innerWidth / 2;
        let targetLeft = 12;
        let side: "left" | "right" = "left";
        if (dialLeft + 25 >= centerPoint) {
          targetLeft = window.innerWidth - 50 - 12;
          side = "right";
        }
        
        dialContainer.style.transition = "left 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), top 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)";
        dialLeft = targetLeft;
        dialContainer.style.left = `${dialLeft}px`;
        
        setTimeout(() => {
          if (dialContainer) {
            dialContainer.style.transition = "none";
          }
        }, 300);
      }
    }, { passive: true });

    // 點擊選單以外區域收合
    window.addEventListener("touchstart", () => {
      if (isDialExpanded) {
        collapseDial();
      }
    }, { passive: true });

    // 視窗尺寸重置調整
    window.addEventListener("resize", () => {
      const centerPoint = window.innerWidth / 2;
      let targetLeft = 12;
      if (dialLeft + 25 >= centerPoint) {
        targetLeft = window.innerWidth - 50 - 12;
      }
      dialLeft = targetLeft;
      dialTop = Math.max(12, Math.min(window.innerHeight - 50 - 12, dialTop));
      dialContainer.style.left = `${dialLeft}px`;
      dialContainer.style.top = `${dialTop}px`;
    }, { passive: true });

    // 子按鈕事件對接
    const itemKeyboard = document.getElementById("dial-item-keyboard");
    if (itemKeyboard) {
      itemKeyboard.onclick = (e) => {
        e.stopPropagation();
        collapseDial();
        isKeyboardActive = true;
        if (hiddenInput) {
          hiddenInput.value = "   ";
          lastValue = "   ";
          hiddenInput.focus();
        }
      };
    }

    const itemMode = document.getElementById("dial-item-mode");
    if (itemMode) {
      itemMode.onclick = (e) => {
        e.stopPropagation();
        collapseDial();
        if (btnTouchMode) {
          btnTouchMode.click();
        }
      };
    }

    const itemDisplay = document.getElementById("dial-item-display");
    if (itemDisplay) {
      itemDisplay.onclick = (e) => {
        e.stopPropagation();
        collapseDial();
        if (btnDisplayMode) {
          btnDisplayMode.click();
        }
      };
    }

    const itemShortcuts = document.getElementById("dial-item-shortcuts");
    if (itemShortcuts) {
      itemShortcuts.onclick = (e) => {
        e.stopPropagation();
        collapseDial();
        if (btnSendKeys) {
          btnSendKeys.click();
        }
      };
    }

    const itemLogs = document.getElementById("dial-item-logs");
    if (itemLogs) {
      itemLogs.onclick = (e) => {
        e.stopPropagation();
        collapseDial();
        const btnDiagnose = document.getElementById("btn-video-diagnose");
        if (btnDiagnose) {
          btnDiagnose.click();
        }
      };
    }
  }

  // 舊事件與舊渲染迴圈已被清理，已併入全新的 setupInputControl 實作。
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
    });
    btnCloseHelp.addEventListener("click", () => {
      helpModal.style.display = "none";
    });
    helpModal.addEventListener("click", (e) => {
      if (e.target === helpModal) {
        helpModal.style.display = "none";
      }
    });
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
// 應用程式初始化入口點
// =========================================================================
window.addEventListener("DOMContentLoaded", async () => {
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
  
  initConnectButton();
  initLicenseVerification();
  initPrivacyMode();
  initNetworkSimulator();
  initAccessPin();
  initSignalingReconnect();
  initStaticPassword();
  // 在 initAccessPin 執行後，才能取得正確產生的 PIN 碼
  myPin = (window as any).__localAccessPin || "";
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
  initVisualViewportListener();
  
  // 啟動狀態輪詢
  startStatusPolling();

  // 依據 Host 與 Client 的產品定位，動態調整左側控制面板顯隱狀態
  if (isDesktopTauri()) {
    // Host 被控端 (Windows / macOS)：不需要「建立遠端連線」卡片與離線連線
    const clientConnSection = document.getElementById("client-connection-section");
    if (clientConnSection) {
      clientConnSection.style.display = "none";
    }
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
      const videoEl = document.getElementById("remote-video") as HTMLVideoElement;
      if (videoEl && videoEl.style.display === "none") {
        if (!signalingWs || signalingWs.readyState !== WebSocket.OPEN) {
          console.log("[Signaling] 網頁控制端獲得焦點，且信令未連線，立即重建連線...");
          initSignalingClient();
        } else {
          console.log("[Signaling] 網頁控制端獲得焦點，發送 ping 驗證連線...");
          signalingWs.send(JSON.stringify({ type: "ping" }));
        }
      }
    });

    document.addEventListener("visibilitychange", () => {
      const videoEl = document.getElementById("remote-video") as HTMLVideoElement;
      if (!document.hidden && videoEl && videoEl.style.display === "none") {
        if (!signalingWs || signalingWs.readyState !== WebSocket.OPEN) {
          console.log("[Signaling] 網頁控制端頁面恢復可見，且信令未連線，立即重建連線...");
          initSignalingClient();
        }
      }
    });
  }

  // 啟動信令連線分流：Tauri 桌面端 Host 走 Rust 後端，Web 控制端走 JS 前端
  if (isDesktopTauri()) {
    console.log("[Signaling] 偵測為 Tauri 桌面環境，註冊 Rust 後端信令維護...");
    
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
        console.log("[Signaling] [Rust] 嘗試連線至信令伺服器...");
      } else if (status === "online") {
        console.log("[Signaling] [Rust] 已成功連線並登入信令伺服器。");
      } else if (status === "offline") {
        console.warn("[Signaling] [Rust] 與信令伺服器連線已斷開，準備重新嘗試連線...");
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
    invoke("start_rust_signaling", { myId: myId, pin: myPin })
      .then(() => {
        console.log("[Signaling] 已成功委託 Rust 後端啟動信令客戶端。");
      })
      .catch((err) => {
        console.error("[Signaling] 啟動 Rust 信令失敗:", err);
      });
  } else {
    // 網頁瀏覽器控制端（Client）
    initSignalingClient();
  }
});

// 初始化行動端虛擬鍵盤拉起時的 Visual Viewport 避讓與對焦自適應
function initVisualViewportListener() {
  const container = document.getElementById("remote-video-container");
  const video = document.getElementById("remote-video") as HTMLVideoElement;
  if (!container || !video || !window.visualViewport) return;

  const handleViewportChange = () => {
    // 只有在連線成功、視訊 container 顯示時才進行自適應避讓
    if (container.style.display === "none") return;

    const vv = window.visualViewport!;
    // 1. 動態將 container 大小調整為視覺視埠大小，避開軟體鍵盤
    container.style.width = `${vv.width}px`;
    container.style.height = `${vv.height}px`;
    container.style.top = `${vv.offsetTop}px`;
    container.style.left = `${vv.offsetLeft}px`;

    // 2. 如果鍵盤彈出 (視覺視埠高度明顯縮小，小於 innerHeight 的 85%)
    const isKeyboardUp = vv.height < window.innerHeight * 0.85;
    if (isKeyboardUp) {
      const cursorYPx = currentCursorPercentY * container.clientHeight * videoScale;
      const targetYPx = vv.height * 0.3; // 我們希望游標位於可見區域上方 30% 處
      if (cursorYPx > targetYPx) {
        keyboardOffsetUpdateY = -(cursorYPx - targetYPx);
      } else {
        keyboardOffsetUpdateY = 0;
      }
      applyVideoTransform();
    } else {
      // 鍵盤收起，恢復預設 transform
      keyboardOffsetUpdateY = 0;
      applyVideoTransform();
    }
  };

  window.visualViewport.addEventListener("resize", handleViewportChange);
  window.visualViewport.addEventListener("scroll", handleViewportChange);
}
