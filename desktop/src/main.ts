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
      const msg = args.map(formatArg).join(' ');
      const line = document.createElement('div');
      line.style.color = color;
      line.textContent = `[${new Date().toISOString().split('T')[1].slice(0,-1)}] ${msg}`;
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
let isLocalPinching = false;
let pinchStartScale = 1;
let pinchStartTx = 0;
let pinchStartTy = 0;
let pinchStartCx = 0;
let pinchStartCy = 0;

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
  "err_invalid_pin": "Please enter the target access PIN."
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
        alert("請輸入固定密碼！");
        return;
      }
      try {
        await invoke("set_static_password", { password: pwd });
        inputPwd.value = "";
        if (statusSpan) {
          statusSpan.textContent = "Status: Set";
          statusSpan.style.color = "var(--success-color, #2ecc71)";
        }
        showToast("固定密碼設定成功！");
      } catch (e) {
        alert("設定固定密碼失敗：" + e);
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
        if (msg.candidate !== undefined) {
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
            if (msg.candidate === "null" || msg.candidate === "") {
              // 忽略 ICE 結束信號，避免 Rust 解析失敗
              break;
            }
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
      case "error":
        console.error("[Signaling] 伺服器錯誤:", msg.message);
        if (msg.message === "Target offline") {
          const offlineMsg = t("err_target_offline") || "對方不在線上，請確認設備 ID 是否正確。";
          const btnConnect = document.getElementById("btn-connect");
          if (btnConnect) {
            btnConnect.textContent = offlineMsg;
            btnConnect.style.backgroundColor = "#e74c3c";
            setTimeout(() => {
              btnConnect.textContent = t("btn_connect") || "開始連線";
              btnConnect.style.backgroundColor = "";
            }, 3000);
          }
          resetConnectionUI();
        } else if (msg.message.includes("Connection rejected")) {
          const rejectMsg = t("err_rejected") || "連線被拒絕：PIN 碼錯誤或對方拒絕連線。";
          const btnConnect = document.getElementById("btn-connect");
          if (btnConnect) {
            btnConnect.textContent = rejectMsg;
            btnConnect.style.backgroundColor = "#e74c3c";
            setTimeout(() => {
              btnConnect.textContent = t("btn_connect") || "開始連線";
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
        
        const leftFloatingMenu = document.getElementById("left-floating-menu");
        if (leftFloatingMenu) leftFloatingMenu.style.display = "flex";
        
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
          
          try {
            videoEl.play();
            setupInputControl(videoEl); // 綁定輸入控制
          } catch (err) {
            console.error("[WebRTC] 視訊播放失敗:", err);
          }
        }
    }
  };

  return pc;
}

// 主動端：建立 Data Channels 並發起 Offer
async function startCall(remoteId: string, pin: string) {
  if (!signalingWs || signalingWs.readyState !== WebSocket.OPEN) {
    alert(t("err_signaling_offline") || "無法連線到信令伺服器，請確認 2syn 服務正在執行。");
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
    alert("建立連線失敗：" + String(e));
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
    alert("處理遠端連線要求時發生錯誤：" + String(e));
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
  
  const leftFloatingMenu = document.getElementById("left-floating-menu");
  if (leftFloatingMenu) {
    leftFloatingMenu.style.display = "none";
  }
}

// 依照 WebRTC connectionState 更新 UI 提示
function updateConnectionStatusUI(state: string) {
  const statusMap: Record<string, string> = {
    connecting: t("conn_connecting") || "連線中...",
    connected:  t("conn_connected")  || "已連線 (P2P)",
    disconnected: t("conn_disconnected") || "已中斷",
    failed:     t("conn_failed")     || "連線失敗",
    closed:     t("conn_closed")     || "已關閉",
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
    alert(t("err_rtc_failed") || "P2P 連線失敗。\n\n若因網路環境受限（例如雙方均無公網 IP、或是行動網路 NAT 過於嚴格），請查看下方的「網路體質與穿透狀態」面板，並點擊【🚀 啟用穿透模式】即可無縫切換為中繼連線。");
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
      window.open('https://tailscale.com/download', '_blank');
      alert(t("txt-tailscale-alert") || '由於您的網路環境受限（無公網 IP 或嚴格 NAT），建議您與遠端主機雙方皆下載並安裝 Tailscale。\n\n登入後即可獲得無限距的高速穿透能力！安裝完成後，此燈號會自動轉為綠色。');
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
          networkDesc.textContent = '已偵測到 Tailscale 虛擬網卡，您現在擁有 100% 的行動網路與 CGNAT 穿透率，連線將極度穩定且高速。';
          btnFixNetwork.style.display = 'none';
        } else if (res.has_ipv6) {
          networkIndicator.style.backgroundColor = '#fbbf24'; // Warning color (yellow)
          networkText.textContent = 'Good (IPv6 Available)';
          networkText.style.color = '#fbbf24';
          networkDesc.textContent = '已偵測到 IPv6 網路，大部份情況下能成功穿透。但若遇到純 IPv4 的嚴格行動網路，可能會降級為中繼模式。建議安裝 Tailscale 以獲取最佳體驗。';
          btnFixNetwork.style.display = 'inline-block';
        } else {
          networkIndicator.style.backgroundColor = '#ef4444'; // Error color (red)
          networkText.textContent = 'Poor (CGNAT / IPv4 Only)';
          networkText.style.color = '#ef4444';
          networkDesc.textContent = '您的網路環境缺乏 IPv6，且位於多重 NAT 之後。極高機率無法建立 P2P 直連，將導致畫面嚴重延遲。強烈建議立即安裝穿透工具！';
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
      alert(t("err_invalid_remote_id") || "請輸入有效的 9 位數設備 ID。");
      return;
    }
    if (!pin || pin.length < 4) {
      alert(t("err_invalid_pin") || "請輸入對方的存取 PIN 碼。");
      return;
    }

    btnConnect.setAttribute("disabled", "true");
    const btnText = document.getElementById("txt-btn-connect");
    if (btnText) btnText.textContent = t("connecting") || "Connecting...";

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
        alert(t("err_license_empty") || "請輸入授權金鑰");
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
          // 主動端：套用遠端 Answer
          await peerConnection.setRemoteDescription({ type: "answer", sdp: remoteSdpText });
          alert(t("alert_sdp_applied") || "SDP Answer 已套用！ICE 協商中...");
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
              alert(t("alert_answer_generated") || "Answer SDP 已產生並複製到剪貼板，請傳送給對方。");
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
        alert("Web 模式下不支援連線診斷功能");
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
  let isOriginalSize = false;
  let panRafId: number | null = null;
  let currentCursorPercentX = 0.5;
  let currentCursorPercentY = 0.5;
  const videoContainer = document.getElementById("remote-video-container") as HTMLElement;
  const btnDisplayMode = document.getElementById("btn-display-mode") as HTMLButtonElement;
  const btnKeyboard = document.getElementById("btn-mobile-keyboard") as HTMLButtonElement;
  const hiddenInput = document.getElementById("hidden-keyboard-input") as HTMLTextAreaElement;
  let isKeyboardActive = false;
  let lastBackspaceTime = 0;
  let isComposing = false;

  if (btnDisplayMode) {
    btnDisplayMode.onclick = () => {
      isOriginalSize = !isOriginalSize;
      if (isOriginalSize) {
        btnDisplayMode.textContent = "🔍 適應視窗 (Scale to Fit)";
        videoEl.style.objectFit = "none";
        // 將視訊大小強制設定為真實解析度
        videoEl.style.width = videoEl.videoWidth + "px";
        videoEl.style.height = videoEl.videoHeight + "px";
        videoContainer.style.overflow = "hidden";
      } else {
        btnDisplayMode.textContent = "🔍 原始大小 (Original Size)";
        videoEl.style.objectFit = "contain";
        videoEl.style.width = "100%";
        videoEl.style.height = "100%";
        // 重置 Pinch 放大相關的 transform 狀態，回歸適應視窗
        videoScale = 1.0;
        videoTranslateX = 0;
        videoTranslateY = 0;
        videoEl.style.transform = "";
      }
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
        if (isOriginalSize) {
          // 模式一：物理大小模式，平移 container 滾動條
          videoContainer.scrollLeft += dx;
          videoContainer.scrollTop += dy;
        } else if (videoScale > 1.0) {
          // 模式二：Scale 放大模式，平移 CSS transform
          const rect = videoEl.getBoundingClientRect();
          const maxTx = ((videoScale - 1) * rect.width) / 2;
          const maxTy = ((videoScale - 1) * rect.height) / 2;
          
          // 畫面往反方向帶：dx > 0 (游標在右側) -> 視訊向左移 (videoTranslateX 減少)
          videoTranslateX -= dx;
          videoTranslateY -= dy;
          
          videoTranslateX = Math.max(-maxTx, Math.min(maxTx, videoTranslateX));
          videoTranslateY = Math.max(-maxTy, Math.min(maxTy, videoTranslateY));
          
          videoEl.style.transform = `translate(${videoTranslateX}px, ${videoTranslateY}px) scale(${videoScale})`;
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
  let isDragging = false;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchStartPos = { x: 0, y: 0 };
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

  // 初始化懸浮選單與 Toggle 切換按鈕
  const leftFloatingMenu = document.getElementById("left-floating-menu");
  if (leftFloatingMenu) {
    leftFloatingMenu.style.display = "flex";
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
    } else {
      let x = 0, y = 0;
      if (isOriginalSize && videoContainer) {
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
        
        if (typeof navigator.vibrate === "function") {
          navigator.vibrate(30);
        }
        console.log("[Gesture] 單指長按，觸發右鍵點擊與震動");
      }, 500);
      
      if (isDirectTouchMode) {
        isDragging = true;
        
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
        
        let x = (lastTouchX - rect.left - offsetX) / renderedWidth;
        let y = (lastTouchY - rect.top - offsetY) / renderedHeight;
        x = Math.max(0, Math.min(1, x));
        y = Math.max(0, Math.min(1, y));
        
        // 點擊處即為滑鼠最新位置
        pendingMouseMoveX = x;
        pendingMouseMoveY = y;
        triggerMoveRaf();
        
        currentCursorPercentX = x;
        currentCursorPercentY = y;

        // 發送 LeftMouseDown
        const payload = new Uint8Array(1);
        payload[0] = 1;
        sendInputPacket(buildInputPacket(0x02, payload));
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
        }
        
        videoEl.style.transform = `translate(${videoTranslateX}px, ${videoTranslateY}px) scale(${videoScale})`;
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
        
        pendingMouseMoveX = x;
        pendingMouseMoveY = y;
        triggerMoveRaf();

        currentCursorPercentX = x;
        currentCursorPercentY = y;
      } else {
        if (lastTouchX !== 0 && lastTouchY !== 0) {
          const dx = currentX - lastTouchX;
          const dy = currentY - lastTouchY;
          
          trackpadCursorX += (dx * 1.5) / renderedWidth;
          trackpadCursorY += (dy * 1.5) / renderedHeight;
          
          if (isNaN(trackpadCursorX)) trackpadCursorX = 0.5;
          if (isNaN(trackpadCursorY)) trackpadCursorY = 0.5;
          
          trackpadCursorX = Math.max(0, Math.min(1, trackpadCursorX));
          trackpadCursorY = Math.max(0, Math.min(1, trackpadCursorY));
          
          pendingMouseMoveX = trackpadCursorX;
          pendingMouseMoveY = trackpadCursorY;
          triggerMoveRaf();

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
    
    if (e.touches.length === 0) {
      if (isKeyboardActive && hiddenInput && document.activeElement !== hiddenInput) {
        hiddenInput.focus();
      }
      // 抬起手指時，立刻重置邊緣平移
      currentCursorPercentX = 0.5;
      currentCursorPercentY = 0.5;

      const now = Date.now();
      
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
      
      if (isDirectTouchMode) {
        if (isDragging) {
          const payload = new Uint8Array(1);
          payload[0] = 1; // Left click release
          sendInputPacket(buildInputPacket(0x03, payload));
          isDragging = false;
        }
      } else {
        if (isDragging) {
          const payload = new Uint8Array(1);
          payload[0] = 1; // Left click release
          sendInputPacket(buildInputPacket(0x03, payload));
          isDragging = false;
        } else {
          if (touchStartTime > 0 && now - touchStartTime < 300) {
            if (maxTouches >= 2) {
              // 雙指輕觸 -> 右鍵點擊
              const payloadDown = new Uint8Array(1);
              payloadDown[0] = 2; // Right click
              sendInputPacket(buildInputPacket(0x02, payloadDown));
              const payloadUp = new Uint8Array(1);
              payloadUp[0] = 2;
              sendInputPacket(buildInputPacket(0x03, payloadUp));
            } else {
              // 單指輕觸 -> 左鍵點擊
              const endX = e.changedTouches.length > 0 ? e.changedTouches[0].clientX : touchStartPos.x;
              const endY = e.changedTouches.length > 0 ? e.changedTouches[0].clientY : touchStartPos.y;
              const dist = Math.sqrt(Math.pow(endX - touchStartPos.x, 2) + Math.pow(endY - touchStartPos.y, 2));
              if (dist < 15) {
                const payloadDown = new Uint8Array(1);
                payloadDown[0] = 1;
                sendInputPacket(buildInputPacket(0x02, payloadDown));
                const payloadUp = new Uint8Array(1);
                payloadUp[0] = 1;
                sendInputPacket(buildInputPacket(0x03, payloadUp));
              }
            }
          }
        }
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
      // 如果正在輸入密碼等欄位，不要攔截
      if (document.activeElement.id !== "hidden-keyboard-input") return;
      // 虛擬鍵盤輸入時不阻擋事件，讓輸入法正常運作
      // 由 input 事件負責計算差異並送出
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
      hiddenInput.value = "";
    }
  };

  const handleEnter = () => {
    sendKeyStroke(13);
    if (hiddenInput) {
      hiddenInput.value = "";
    }
  };

  if (btnKeyboard && hiddenInput) {
    btnKeyboard.addEventListener("click", (e) => {
      e.stopPropagation();
      isKeyboardActive = true;
      hiddenInput.focus();
    });

    hiddenInput.addEventListener("blur", () => {
      isKeyboardActive = false;
    });

    hiddenInput.addEventListener("compositionstart", () => {
      isComposing = true;
    });

    hiddenInput.addEventListener("compositionend", () => {
      isComposing = false;
      const val = hiddenInput.value;
      if (val.length > 0) {
        const encoder = new TextEncoder();
        const payload = encoder.encode(val);
        sendInputPacket(buildInputPacket(0x08, payload));
        hiddenInput.value = "";
      }
    });

    hiddenInput.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" || e.keyCode === 8) {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === "Enter" || e.keyCode === 13) {
        e.preventDefault();
        handleEnter();
      }
    });

    hiddenInput.addEventListener("input", (e: Event) => {
      if (isComposing) return;

      const inputType = (e as any).inputType;

      if (inputType === "deleteContentBackward") {
        handleBackspace();
        return;
      }

      if (inputType === "insertLineBreak") {
        handleEnter();
        return;
      }

      const val = hiddenInput.value;
      if (val.length > 0) {
        const encoder = new TextEncoder();
        const payload = encoder.encode(val);
        sendInputPacket(buildInputPacket(0x08, payload));
        hiddenInput.value = "";
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
// 應用程式初始化入口點
// =========================================================================
window.addEventListener("DOMContentLoaded", async () => {
  await initI18n();

  // 啟動時檢查並請求 macOS 權限 (螢幕錄影、輔助使用)
  try {
    const permissionsGranted = await invoke<boolean>("check_macos_permissions");
    if (!permissionsGranted) {
      console.warn("macOS permissions are missing. Native prompt should have appeared.");
    }
  } catch (err) {
    console.error("Failed to check macOS permissions:", err);
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
      networkDesc.textContent = "純網頁控制端。連線建立時將會自動評估最佳傳輸管線。若因雙方處於嚴格 NAT 或防火牆後導致連線失敗，請點擊【🚀 啟用穿透模式】。";
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
