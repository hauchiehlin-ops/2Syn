import { invoke } from "@tauri-apps/api/core";

// 宣告語系翻譯字典快取
let translations: Record<string, string> = {};

// 萬用英文 Fallback 字典，供載入錯誤或翻譯遺漏時調用，徹底與寫死中文解耦
const fallbackTranslations: Record<string, string> = {
  "my_id_loading": "Loading...",
  "hwid_loading": "Loading...",
  "hwid_failed": "Failed to get HWID",
  "status_active": "Activated (Buyout)",
  "status_inactive": "Unauthorized",
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
  "metric_rtt": "Network Latency (RTT)",
  "metric_loss": "Packet Loss Rate",
  "metric_protocol": "Connection Protocol",
  "metric_encryption": "Codec & Cipher Security"
};

// 統一翻譯取值函數
function t(key: string): string {
  return translations[key] || fallbackTranslations[key] || key;
}

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
function generateMockMyId() {
  const valMyId = document.getElementById("val-my-id");
  if (valMyId) {
    // 隨機產生 xxx-xxx-xxx 格式 ID
    const r = () => Math.floor(100 + Math.random() * 900);
    valMyId.textContent = `${r()}-${r()}-${r()}`;
  }
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

// 初始化「開始連線」按鈕事件
function initConnectButton() {
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
    const originalText = btnText?.textContent || "Connect";
    if (btnText) btnText.textContent = t("connecting") || "Connecting...";

    console.log(`[Frontend] 嘗試發起連線至 ${remoteId} (PIN: ${pin})`);
    try {
      const result = await invoke<string>("initiate_connection", {
        remoteId,
        accessPin: pin,
      });
      console.log(`[Frontend] 連線回傳結果:`, result);
      alert(t(result) || result);
    } catch (error) {
      console.error(`[Frontend] 連線發生錯誤:`, error);
      const errStr = String(error);
      alert(t(errStr) || errStr);
    } finally {
      btnConnect.removeAttribute("disabled");
      if (btnText) btnText.textContent = originalText;
    }
  });
}


// 授權金鑰驗證
async function initLicenseVerification() {
  const btnVerify = document.getElementById("btn-verify-license");
  const licenseInput = document.getElementById("license-input") as HTMLInputElement;
  const statusBadge = document.getElementById("license-status");

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
    } catch (error) {
      console.error("狀態輪詢出錯:", error);
    }
  }, 500);
}

// 初始化離線手動 SDP 連線控制
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
        // 呼叫後端產生 SDP Offer
        const localSdp = await invoke<string>("generate_local_sdp_offer");
        txtLocal.value = localSdp;
        // 自動選取並複製到剪貼簿
        txtLocal.select();
        navigator.clipboard.writeText(localSdp);
        alert(t("alert_sdp_success"));
      } catch (error) {
        const errorStr = String(error);
        const displayError = t(errorStr);
        alert(`${t("alert_sdp_fail")}${displayError}`);
      }
    });
  }

  if (btnApplyRemote && txtRemote) {
    btnApplyRemote.addEventListener("click", async () => {
      const remoteSdp = txtRemote.value.trim();
      if (!remoteSdp) {
        alert(t("alert_sdp_empty"));
        return;
      }
      try {
        // 呼叫後端套用對方的 SDP
        const result = await invoke<string>("apply_remote_sdp_answer", { sdp: remoteSdp });
        alert(t(result));
      } catch (error) {
        const errorStr = String(error);
        const displayError = t(errorStr);
        alert(`${t("alert_sdp_apply_fail")}${displayError}`);
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
    } catch (e) {
      console.error(e);
    }
  }, 1000);
}

// =========================================================================
// 應用程式初始化入口點
// =========================================================================
window.addEventListener("DOMContentLoaded", async () => {
  await initI18n();
  generateMockMyId();
  await fetchHwid();
  initAccessPin();
  initConnectButton();
  initLicenseVerification();
  initPrivacyMode();
  initNetworkSimulator();
  initOfflineSdpMode();
  initSystemDiagnostic();
  initHelpButtons();
  initClipboardCopy();
  initSmartAutoMode();
  initFileTransfer();
  
  // 啟動狀態輪詢
  startStatusPolling();
});
