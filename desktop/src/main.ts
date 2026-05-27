import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { listen } from "@tauri-apps/api/event";


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
let iceCandidateQueue: RTCIceCandidateInit[] = [];
let rustIceCandidateQueue: string[] = [];
let isHostMode: boolean = false; // 標記目前是否為被控端
let rustOfferProcessed: boolean = false; // 標記 Rust 是否已經處理完 Offer
let dataChannelControl: RTCDataChannel | null = null;
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

// STUN 與 TURN 伺服器清單（已恢復 TURN 備援機制，確保極端網路環境下的高可用性）
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: ["turn:openrelay.metered.ca:80"],
    username: "openrelayproject",
    credential: "openrelayproject"
  },
  {
    urls: ["turn:openrelay.metered.ca:443"],
    username: "openrelayproject",
    credential: "openrelayproject"
  }
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
  "sim_title": "PoC Network Simulator",
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
  "log_title": "System Logs"
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
  if (!isTauri()) {
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
  
  // 從 sessionStorage 取回已產生的 ID，確保重整後 ID 一致
  let storedId = sessionStorage.getItem("2syn_my_id");
  if (!storedId) {
    storedId = `${r()}${r()}${r()}`;
    sessionStorage.setItem("2syn_my_id", storedId);
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
      btnRefresh.textContent = "✓";
      setTimeout(() => { btnRefresh.textContent = "🔄"; }, 1000);
    });
  }

  if (btnCopyPin && valPin) {
    btnCopyPin.addEventListener("click", () => {
      const pinText = valPin.textContent || "";
      navigator.clipboard.writeText(pinText).then(() => {
        btnCopyPin.textContent = "✓";
        setTimeout(() => { btnCopyPin.textContent = "📋"; }, 1500);
      });
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
    
    // 建立 30 秒心跳，防止 Render 負載平衡器因為閒置超過 15 分鐘而強制斷線
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
        signalingWs.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
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
          alert(t("err_target_offline") || "對方不在線上，請確認設備 ID 是否正確。");
          resetConnectionUI();
        } else if (msg.message.includes("Connection rejected")) {
          alert("連線被拒絕：PIN 碼錯誤或對方拒絕連線。");
          resetConnectionUI();
        }
        break;
    }
  };

  signalingWs.onclose = () => {
    console.warn("[Signaling] WebSocket 已斷線，5 秒後重新嘗試...");
    signalingWs = null;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    setTimeout(initSignalingClient, 5000);
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
        const mainContent = document.querySelector(".glass-container") as HTMLElement;
        const btnKeyboard = document.getElementById("btn-mobile-keyboard") as HTMLButtonElement;
        
        videoEl.style.display = "block";
        if (mainContent) mainContent.style.display = "none";
        
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
      maxRetransmits: 0, // 低延遲，不重傳
    });
    bindControlChannel(dataChannelControl);

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
    const isWebBrowser = !isTauri();
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

  // 2. 驗證 PIN 是否符合本機 Access PIN
  if (incomingPin !== myPin) {
    console.warn(`[WebRTC] 拒絕連線：PIN 碼不符 (收到: ${incomingPin}, 預期: ${myPin})`);
    if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
      signalingWs.send(JSON.stringify({
        type: "error",
        target: sourceId,
        message: "Connection rejected"
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
  
  if (videoEl) {
    videoEl.style.display = "none";
    videoEl.srcObject = null;
  }
  if (mainContent) {
    mainContent.style.display = "flex";
  }
  if (btnKeyboard) {
    btnKeyboard.style.display = "none";
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
    alert(t("err_rtc_failed") || "P2P 連線失敗。\n請確認雙方均已啟動 2syn，且防火牆允許 UDP 流量。");
    resetConnectionUI();
  } else if (state === "disconnected" || state === "closed") {
    resetConnectionUI();
  }
}

// =========================================================================
// 初始化「開始連線」按鈕事件
// =========================================================================
function initConnectButton() {
  if (isTauri()) {
    // 監聽來自 Rust 的影像擷取與編碼狀態 (例如沒有權限、編碼失敗等)
  listen<string>('rust-video-status', (event) => {
    console.error(`[WebRTC-Video] 影像處理發生問題: ${event.payload}`);
  });

  listen<any>('rust-webrtc-state', (event) => {
    console.log(`[WebRTC-Rust] 狀態變更: ${event.payload}`);
  });

  
  const btnFixNetwork = document.getElementById('btn-fix-network');
  const networkIndicator = document.getElementById('network-health-indicator');
  const networkText = document.getElementById('network-health-text');
  const networkDesc = document.getElementById('network-health-desc');

  if (btnFixNetwork) {
    btnFixNetwork.addEventListener('click', () => {
      open('https://tailscale.com/download');
      alert('請下載並安裝 Tailscale，登入後即可獲得無限距穿透能力！\n安裝完成後，此燈號會自動轉為綠色。');
    });
  }

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
  const isWebBrowser = !isTauri();

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
      if (!isTauri()) {
        alert("Web 模式下不支援實體防窺切換");
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
  if (!isTauri()) return;
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
        dataChannelControl = pc.createDataChannel("input-control", { ordered: true, maxRetransmits: 0 });
        bindControlChannel(dataChannelControl);
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
      
      if (!isTauri()) {
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
    // 先寫死一個假路徑，或者透過 Tauri API 挑選檔案
    alert("In a real Tauri app, we would use the absolute path of this file. PoC will simulate the transfer.");
    
    // 模擬啟動傳輸（若被封鎖會跳警告）
    if (!isTauri()) {
        alert("Web 模式下不支援檔案傳輸");
        return;
      }
      try {
      const taskId = await invoke<string>("send_file", { path: "/tmp/dummy_file.txt" });
      currentTransferTaskId = taskId;
      
      if (filenameEl) filenameEl.textContent = file.name;
      if (progressContainer) progressContainer.style.display = "flex";
      
      // 啟動進度輪詢
      startTransferPolling(taskId);
      
    } catch (e) {
      alert(t(String(e)) || String(e));
    }
  });

  if (btnCancel) {
    btnCancel.addEventListener("click", async () => {
      if (!isTauri()) return;
      if (currentTransferTaskId) {
        await invoke("cancel_transfer", { taskId: currentTransferTaskId });
        currentTransferTaskId = null;
        if (progressContainer) progressContainer.style.display = "none";
        if (transferPollingInterval) clearInterval(transferPollingInterval);
        alert("Transfer cancelled.");
      }
    });
  }
}

function startTransferPolling(taskId: string) {
  if (transferPollingInterval) clearInterval(transferPollingInterval);
  
  const pctEl = document.getElementById("transfer-pct");
  const barEl = document.getElementById("transfer-progress-bar");
  const progressContainer = document.getElementById("transfer-progress-container");

  transferPollingInterval = window.setInterval(async () => {
    if (!isTauri()) return;
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

let inputSeqNumber = 0;
let inputBound = false;

function buildInputPacket(eventType: number, payload: Uint8Array): Uint8Array {
  inputSeqNumber++;
  const timestamp = Date.now();
  const packet = new Uint8Array(12 + 1 + payload.length);
  const view = new DataView(packet.buffer);
  
  view.setUint32(0, inputSeqNumber, false);
  view.setUint32(4, Math.floor(timestamp / 0x100000000), false);
  view.setUint32(8, timestamp % 0x100000000, false);
  
  packet[12] = eventType;
  packet.set(payload, 13);
  return packet;
}

function sendInputPacket(packet: Uint8Array) {
  if (dataChannelControl && dataChannelControl.readyState === "open") {
    dataChannelControl.send(packet as any);
  }
}

function setupInputControl(videoEl: HTMLVideoElement) {
  if (inputBound) return;
  inputBound = true;

  const sendPointerMove = (e: PointerEvent) => {
    const rect = videoEl.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));

    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setFloat32(0, x, false);
    view.setFloat32(4, y, false);
    sendInputPacket(buildInputPacket(0x01, payload));
  };

  videoEl.addEventListener("pointermove", (e) => {
    e.preventDefault();
    if (document.pointerLockElement === videoEl) {
      // 在 Pointer Lock 模式下，傳送相對位移 (dx, dy)
      const dx = Math.round(e.movementX);
      const dy = Math.round(e.movementY);
      const payload = new Uint8Array(8);
      const view = new DataView(payload.buffer);
      view.setInt32(0, dx, false);
      view.setInt32(4, dy, false);
      sendInputPacket(buildInputPacket(0x07, payload));
    } else {
      // 觸控螢幕或未鎖定時，使用絕對比例座標
      sendPointerMove(e);
    }
  });

  videoEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    
    // 移除 requestPointerLock，因為 macOS 原生截圖 API 不會擷取遠端硬體游標，
    // 若將本地端游標隱藏 (Pointer Lock) 會導致使用者完全看不到滑鼠（沒有游標）。
    // 我們讓本地端保留游標顯示，並依賴絕對座標系統來精準對位。
    
    // 對於觸控設備，點擊時不一定會先觸發 pointermove，必須在點下前先同步游標位置
    if (document.pointerLockElement !== videoEl) {
      sendPointerMove(e);
    }
    
    const payload = new Uint8Array(1);
    let btn = 1;
    if (e.button === 2) btn = 2;
    if (e.button === 1) btn = 3;
    payload[0] = btn;
    sendInputPacket(buildInputPacket(0x02, payload));
  });

  videoEl.addEventListener("pointerup", (e) => {
    e.preventDefault();
    const payload = new Uint8Array(1);
    let btn = 1;
    if (e.button === 2) btn = 2;
    if (e.button === 1) btn = 3;
    payload[0] = btn;
    sendInputPacket(buildInputPacket(0x03, payload));
  });

  // 特別針對 iOS WKWebView 的 touch 事件進行攔截，轉換為相對應的絕對座標與左鍵點擊
  const handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const rect = videoEl.getBoundingClientRect();
      
      // 計算真實的影片內容邊界 (扣除 object-fit: contain 產生的黑邊)
      const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
      const containerRatio = rect.width / rect.height;
      
      let renderedWidth, renderedHeight, offsetX = 0, offsetY = 0;
      
      if (containerRatio > videoRatio) {
        // 左右有黑邊 (Pillarboxed)
        renderedHeight = rect.height;
        renderedWidth = renderedHeight * videoRatio;
        offsetX = (rect.width - renderedWidth) / 2;
      } else {
        // 上下有黑邊 (Letterboxed)
        renderedWidth = rect.width;
        renderedHeight = renderedWidth / videoRatio;
        offsetY = (rect.height - renderedHeight) / 2;
      }

      let x = (touch.clientX - rect.left - offsetX) / renderedWidth;
      let y = (touch.clientY - rect.top - offsetY) / renderedHeight;
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
  
      const payload = new Uint8Array(8);
      const view = new DataView(payload.buffer);
      view.setFloat32(0, x, false);
      view.setFloat32(4, y, false);
      sendInputPacket(buildInputPacket(0x01, payload));
    }
  };

  let currentZoom = 1;
  let currentPanX = 0;
  let currentPanY = 0;
  let initialPinchDistance = -1;
  let initialZoom = 1;
  let lastTouchX = 0;
  let lastTouchY = 0;

  function getPinchDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function updateVideoTransform() {
    videoEl.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${currentZoom})`;
  }

  videoEl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      initialPinchDistance = getPinchDistance(e.touches);
      initialZoom = currentZoom;
      lastTouchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastTouchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    } else if (e.touches.length === 1) {
      handleTouchMove(e);
      const payload = new Uint8Array(1);
      payload[0] = 1; // Left click
      sendInputPacket(buildInputPacket(0x02, payload));
    }
  }, { passive: false });

  videoEl.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      // 雙指縮放與平移
      const currentDistance = getPinchDistance(e.touches);
      if (initialPinchDistance > 0) {
        currentZoom = Math.max(1, Math.min(5, initialZoom * (currentDistance / initialPinchDistance)));
      }
      
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
      if (lastTouchX !== 0 && lastTouchY !== 0) {
        currentPanX += (centerX - lastTouchX);
        currentPanY += (centerY - lastTouchY);
      }
      
      lastTouchX = centerX;
      lastTouchY = centerY;
      
      const rect = videoEl.getBoundingClientRect();
      // 限制平移範圍，不讓畫面跑出界外太多
      const maxPanX = (rect.width * currentZoom - rect.width) / 2;
      const maxPanY = (rect.height * currentZoom - rect.height) / 2;
      currentPanX = Math.max(-maxPanX, Math.min(maxPanX, currentPanX));
      currentPanY = Math.max(-maxPanY, Math.min(maxPanY, currentPanY));
      
      updateVideoTransform();
    } else if (e.touches.length === 1) {
      // 單指控制滑鼠
      handleTouchMove(e);
    }
  }, { passive: false });

  videoEl.addEventListener("touchend", (e) => {
    e.preventDefault();
    if (e.touches.length === 0) {
      initialPinchDistance = -1;
      lastTouchX = 0;
      lastTouchY = 0;
      const payload = new Uint8Array(1);
      payload[0] = 1; // Left click release
      sendInputPacket(buildInputPacket(0x03, payload));
    } else if (e.touches.length === 1) {
      // 雙指放開一指，重新設定單指位置避免跳躍
      initialPinchDistance = -1;
      lastTouchX = 0;
      lastTouchY = 0;
    }
  }, { passive: false });

  // 禁用右鍵選單
  videoEl.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    if (videoEl.style.display === "none") return;
    const payload = new Uint8Array(3);
    const view = new DataView(payload.buffer);
    
    // 嘗試將鍵盤代碼轉移
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
    
    sendInputPacket(buildInputPacket(0x04, payload));
  });

  // 攔截鍵盤按下 (KeyDown)
  window.addEventListener("keydown", (e) => {
    if (videoEl.style.display === "none") return;
    
    // 阻止預設行為 (例如空白鍵向下捲動、Tab 切換焦點)，讓按鍵能完整送給遠端
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
    
    sendInputPacket(buildInputPacket(0x05, payload)); // 0x05 是 KeyDown
  });

  // 攔截鍵盤放開 (KeyUp)
  window.addEventListener("keyup", (e) => {
    if (videoEl.style.display === "none") return;
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
    
    sendInputPacket(buildInputPacket(0x06, payload)); // 0x06 是 KeyUp
  });

  // 處理手機虛擬鍵盤觸發邏輯
  const btnMobileKeyboard = document.getElementById("btn-mobile-keyboard") as HTMLButtonElement;
  const hiddenKeyboardInput = document.getElementById("hidden-keyboard-input") as HTMLTextAreaElement;
  
  if (btnMobileKeyboard && hiddenKeyboardInput) {
    // 點擊懸浮按鈕時，讓隱藏輸入框獲得焦點，強制 iOS Safari 彈出小鍵盤
    btnMobileKeyboard.addEventListener("click", () => {
      hiddenKeyboardInput.focus();
      btnMobileKeyboard.style.background = "rgba(0, 132, 255, 0.4)";
    });

    // 當隱藏輸入框失去焦點時，恢復按鈕顏色
    hiddenKeyboardInput.addEventListener("blur", () => {
      btnMobileKeyboard.style.background = "rgba(255,255,255,0.2)";
    });

    // 攔截虛擬鍵盤的直接輸入事件 (針對無法正確觸發 keydown keyCode 的 iOS 鍵盤)
    hiddenKeyboardInput.addEventListener("input", (e: any) => {
      if (e.inputType === "insertText" && e.data) {
        const char = e.data;
        const keyCode = char.toUpperCase().charCodeAt(0);
        
        // 送出 KeyDown
        const downPayload = new Uint8Array(3);
        const downView = new DataView(downPayload.buffer);
        downView.setUint16(0, keyCode, false);
        downPayload[2] = 0;
        sendInputPacket(buildInputPacket(0x04, downPayload));

        // 送出 KeyUp
        const upPayload = new Uint8Array(3);
        const upView = new DataView(upPayload.buffer);
        upView.setUint16(0, keyCode, false);
        upPayload[2] = 0;
        sendInputPacket(buildInputPacket(0x05, upPayload));
        
        hiddenKeyboardInput.value = ""; // 清空
      }
    });
  }
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
}

// =========================================================================
// 應用程式初始化入口點
// =========================================================================
window.addEventListener("DOMContentLoaded", async () => {
  await initI18n();

  const generatedId = generateMockMyId();
  if (generatedId) myId = generatedId;

  await fetchHwid();
  initAccessPin();
  // 在 initAccessPin 執行後，才能取得正確產生的 PIN 碼
  myPin = (window as any).__localAccessPin || "";
  
  initConnectButton();
  initLicenseVerification();
  initPrivacyMode();
  initNetworkSimulator();
  initPanelToggle();
  initOfflineSdpMode();
  initSystemDiagnostic();
  initHelpButtons();
  initClipboardCopy();
  initSmartAutoMode();
  initFileTransfer();
  
  // 啟動狀態輪詢
  startStatusPolling();

  // 啟動信令 WebSocket 連線（信令伺服器必須先啟動）
  initSignalingClient();
});
