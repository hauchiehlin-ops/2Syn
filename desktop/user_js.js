(function () {
  const o = document.createElement("link").relList;
  if (o && o.supports && o.supports("modulepreload")) return;
  for (const n of document.querySelectorAll('link[rel="modulepreload"]')) a(n);
  new MutationObserver((n) => {
    for (const s of n)
      if (s.type === "childList")
        for (const r of s.addedNodes)
          r.tagName === "LINK" && r.rel === "modulepreload" && a(r);
  }).observe(document, { childList: !0, subtree: !0 });
  function t(n) {
    const s = {};
    return (
      n.integrity && (s.integrity = n.integrity),
      n.referrerPolicy && (s.referrerPolicy = n.referrerPolicy),
      n.crossOrigin === "use-credentials"
        ? (s.credentials = "include")
        : n.crossOrigin === "anonymous"
          ? (s.credentials = "omit")
          : (s.credentials = "same-origin"),
      s
    );
  }
  function a(n) {
    if (n.ep) return;
    n.ep = !0;
    const s = t(n);
    fetch(n.href, s);
  }
})();
function q(e, o = !1) {
  return window.__TAURI_INTERNALS__.transformCallback(e, o);
}
async function m(e, o = {}, t) {
  return window.__TAURI_INTERNALS__.invoke(e, o, t);
}
function g() {
  return !!(globalThis || window).isTauri;
}
var M;
(function (e) {
  ((e.WINDOW_RESIZED = "tauri://resize"),
    (e.WINDOW_MOVED = "tauri://move"),
    (e.WINDOW_CLOSE_REQUESTED = "tauri://close-requested"),
    (e.WINDOW_DESTROYED = "tauri://destroyed"),
    (e.WINDOW_FOCUS = "tauri://focus"),
    (e.WINDOW_BLUR = "tauri://blur"),
    (e.WINDOW_SCALE_FACTOR_CHANGED = "tauri://scale-change"),
    (e.WINDOW_THEME_CHANGED = "tauri://theme-changed"),
    (e.WINDOW_CREATED = "tauri://window-created"),
    (e.WINDOW_SUSPENDED = "tauri://suspended"),
    (e.WINDOW_RESUMED = "tauri://resumed"),
    (e.WEBVIEW_CREATED = "tauri://webview-created"),
    (e.DRAG_ENTER = "tauri://drag-enter"),
    (e.DRAG_OVER = "tauri://drag-over"),
    (e.DRAG_DROP = "tauri://drag-drop"),
    (e.DRAG_LEAVE = "tauri://drag-leave"));
})(M || (M = {}));
async function Q(e, o) {
  (window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(e, o),
    await m("plugin:event|unlisten", { event: e, eventId: o }));
}
async function A(e, o, t) {
  var a;
  const n = (a = void 0) !== null && a !== void 0 ? a : { kind: "Any" };
  return m("plugin:event|listen", { event: e, target: n, handler: q(o) }).then(
    (s) => async () => Q(e, s),
  );
}
function Y(e, o = 3e3) {
  const t = document.getElementById("toast-container");
  if (!t) return;
  const a = document.createElement("div");
  ((a.className = "toast-msg"),
    (a.textContent = e),
    t.appendChild(a),
    setTimeout(() => {
      ((a.style.opacity = "0"),
        (a.style.transform = "translateY(-20px)"),
        (a.style.transition = "all 0.3s ease"),
        setTimeout(() => a.remove(), 300));
    }, o));
}
(function () {
  const e = console.log,
    o = console.error;
  function t(n) {
    return n instanceof Error
      ? `${n.name}: ${n.message}
${n.stack}`
      : typeof n == "object"
        ? JSON.stringify(n)
        : String(n);
  }
  function a(n, s, r = !1) {
    if (
      (r ? o.apply(console, s) : e.apply(console, s), typeof document < "u")
    ) {
      const d = document.getElementById("debug-overlay");
      if (!d) return;
      const l = s.map(t).join(" "),
        f = document.createElement("div");
      for (
        f.style.color = n,
          f.textContent = `[${new Date().toISOString().split("T")[1].slice(0, -1)}] ${l}`,
          d.appendChild(f);
        d.children.length > 100;
      )
        d.removeChild(d.firstChild);
      if (((d.scrollTop = d.scrollHeight), r)) {
        const y =
          typeof window.t == "function"
            ? window.t("toast_system_error")
            : "⚠️ System Error: Open Advanced Panel to view logs";
        Y(y, 5e3);
      }
    }
  }
  ((console.log = (...n) => a("#0f0", n)),
    (console.warn = (...n) => a("#ff0", n)),
    (console.error = (...n) => a("#f00", n, !0)));
})();
let u = null,
  p = null,
  L = [],
  B = [],
  W = !1,
  _ = null,
  I = null,
  E = null,
  j = "",
  R = "";
const X = "wss://twosyn-signaling.onrender.com/ws";
function Z() {
  return window.__SIGNALING_URL__ ? window.__SIGNALING_URL__ : X;
}
const N = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: ["turn:openrelay.metered.ca:80"],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: ["turn:openrelay.metered.ca:443"],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];
let K = {};
const ee = {
  my_id_loading: "Loading...",
  hwid_loading: "Loading...",
  hwid_failed: "Failed to get HWID",
  status_active: "Activated (Buyout)",
  status_inactive: "Unauthorized",
  status_trial: "Trial ({0} days left)",
  status_expired: "Trial Expired",
  err_host_expired:
    "Host trial period has expired. Please enter a valid license key to continue receiving connections.",
  alert_license_success:
    "Activation successful! The license ticket is securely stored locally.",
  alert_license_fail: "Activation failed: invalid key or hardware mismatch.",
  alert_license_error: "Verification error: ",
  err_invalid_signature: "The activation ticket signature is invalid.",
  err_no_ticket: "Server returned no activation ticket.",
  err_connect_server: "Failed to connect to the activation server: ",
  err_limit_exceeded:
    "Activation failed: the activation limit (max 5 devices) has been reached. Currently bound: {0}",
  err_cooldown_active:
    "Cooldown active: deactivation is too frequent, please try again in {0} seconds.",
  err_invalid_license: "Invalid license key.",
  err_device_not_bound: "Deactivation failed: device is not bound to this key.",
  err_license_empty: "License key and HWID cannot be empty.",
  file_enabled: "Enabled",
  file_disabled: "Disabled (degraded protection)",
  alert_sdp_success:
    "Local SDP Offer generated and copied to clipboard successfully.",
  alert_sdp_fail: "Failed to generate SDP: ",
  alert_sdp_empty: "Please paste the remote SDP first.",
  alert_sdp_apply_fail: "Failed to apply SDP: ",
  alert_sdp_applied: `Successfully applied remote SDP! ICE negotiating...
Decentralized secure handshake complete! AES-256-GCM data channel established.`,
  diag_status_checking: "Checking...",
  alert_diag_failed: "Diagnostic failed: ",
  protocol_p2p: "WebRTC P2P (Direct)",
  protocol_relay: "Relay (TURN)",
  encryption_gcu: "AES-256-GCM (GPU Accelerated)",
  diag_dns_success: "Success (Connected)",
  diag_dns_failed: "Failed (No Connection)",
  diag_initial_desc:
    "Click the button above to run diagnostics on secure storage and network pipes.",
  copy_tooltip: "Copy",
  connect_title: "Establish Connection",
  remote_id_placeholder: "Enter 9-digit Device ID",
  access_pin_placeholder: "Enter access PIN",
  btn_connect: "Connect",
  host_info_title: "Host Information",
  remote_id: "Remote Device ID",
  access_pin_label: "Access PIN",
  access_pin_help:
    "Enter the 6-digit access PIN displayed on the remote device.",
  my_pin_label: "Access PIN:",
  my_id: "My ID:",
  hwid: "My HWID:",
  license: "Buyout License Key",
  privacy_title: "Security & Privacy",
  privacy_mode: "Privacy Shield Mode (Virtual GPU)",
  monitor_title: "Network & Video Quality Metrics",
  metric_fps: "Target Frame Rate",
  metric_color: "Color Sampling",
  metric_bitrate: "Max Bitrate Limit",
  metric_file: "File Transfer",
  sim_title: "PoC Network Simulator",
  sim_desc:
    "Adjust network parameters to verify the dynamic degradation of the quality decision tree.",
  sim_rtt: "RTT Latency",
  sim_loss: "Packet Loss Rate",
  sim_relay: "Force Relay Connection",
  diag_title: "Security & Connectivity Diagnostics",
  diag_btn: "Run Diagnostics",
  diag_dns: "STUN Server Lookup:",
  diag_nat: "NAT Detection Type:",
  diag_suggest: "Optimization Suggestions",
  offline_mode: "Offline Connection (SDP)",
  offline_btn_gen: "Generate & Copy Local SDP Offer",
  offline_local_placeholder: "Local SDP will be generated here",
  offline_remote_label: "Enter Remote SDP Answer/Offer",
  offline_remote_placeholder: "Paste Remote SDP here",
  offline_btn_apply: "Establish Connection",
  license_btn_verify: "Verify",
  license_placeholder: "Enter license key",
  smart_auto: "Smart Quality Auto-Optimization",
  smart_auto_active_desc:
    "System automatically adjusting. Network and stream quality are in optimal states.",
  sim_advanced_header: "Advanced Developer Tools",
  metric_loss: "Packet Loss Rate",
  metric_protocol: "Connection Protocol",
  metric_encryption: "Codec & Cipher Security",
  toast_system_error: "⚠️ System Error: Open Advanced Panel to view logs",
  toggle_panel_title: "Toggle Advanced Panel",
  tools_title: "Advanced Tools",
  file_transfer_title: "File Transfer",
  drop_zone: "Drag & Drop files here or Click to upload",
  btn_cancel_transfer: "Cancel Transfer",
  log_title: "System Logs",
};
function i(e) {
  return K[e] || ee[e] || e;
}
window.t = i;
let w = null;
function z() {
  if (!w) return;
  const e = document.getElementById("val-diag-dns"),
    o = document.getElementById("val-diag-nat"),
    t = document.getElementById("val-diag-suggest");
  (e &&
    ((e.textContent = w.stun_dns_resolved
      ? i("diag_dns_success")
      : i("diag_dns_failed")),
    (e.style.color = w.stun_dns_resolved
      ? "var(--color-success)"
      : "var(--color-danger)")),
    o &&
      ((o.textContent = i(w.nat_type)),
      (o.style.color = w.license_active
        ? "var(--color-success)"
        : "var(--color-danger)")),
    t && (t.textContent = i(w.suggested_action)));
}
async function te() {
  const e = document.getElementById("language-select");
  e.addEventListener("change", async (a) => {
    const n = a.target;
    await V(n.value);
  });
  const o = navigator.language;
  let t = "zh-TW";
  (o.startsWith("zh-CN")
    ? (t = "zh-CN")
    : o.startsWith("ja")
      ? (t = "ja")
      : o.startsWith("ko")
        ? (t = "ko")
        : o.startsWith("de")
          ? (t = "de")
          : o.startsWith("th")
            ? (t = "th")
            : o.startsWith("id")
              ? (t = "id")
              : o.startsWith("ms")
                ? (t = "ms")
                : o.startsWith("ru")
                  ? (t = "ru")
                  : o.startsWith("es")
                    ? (t = "es")
                    : (o.startsWith("en") || !o.startsWith("zh")) && (t = "en"),
    (e.value = t),
    await V(t));
}
async function V(e) {
  try {
    ((K = await (await fetch(`/locales/${e}.json`)).json()), ne());
  } catch (o) {
    console.error(`無法載入語系檔 [${e}]:`, o);
  }
}
function ne() {
  (c("txt-connect-title", i("connect_title")),
    k("remote-id-input", i("remote_id_placeholder")),
    k("access-pin-input", i("access_pin_placeholder")),
    c("txt-btn-connect", i("btn_connect")),
    c("txt-host-info-title", i("host_info_title")),
    c("lbl-remote-id", i("remote_id")),
    c("lbl-access-pin", i("access_pin_label")),
    c("lbl-my-pin", i("my_pin_label")),
    c("lbl-my-id", i("my_id")),
    c("lbl-hwid", i("hwid")),
    c("lbl-license", i("license")),
    c("txt-privacy-title", i("privacy_title")),
    c("lbl-privacy-mode", i("privacy_mode")),
    c("txt-monitor-title", i("monitor_title")),
    c("lbl-metric-fps", i("metric_fps")),
    c("lbl-metric-color", i("metric_color")),
    c("lbl-metric-bitrate", i("metric_bitrate")),
    c("lbl-metric-file", i("metric_file")),
    c("txt-sim-title", i("sim_title")),
    c("txt-sim-desc", i("sim_desc")),
    c("lbl-sim-rtt", i("sim_rtt")),
    c("lbl-sim-loss", i("sim_loss")),
    c("lbl-sim-relay", i("sim_relay")),
    c("txt-tools-title", i("tools_title")),
    c("txt-file-transfer-title", i("file_transfer_title")),
    c("txt-drop-zone", i("drop_zone")),
    c("btn-cancel-transfer", i("btn_cancel_transfer")),
    c("txt-log-title", i("log_title")));
  const e = document.getElementById("btn-toggle-panel");
  if (
    (e && (e.title = i("toggle_panel_title")),
    c("txt-diag-title", i("diag_title")),
    c("btn-run-diagnostic", i("diag_btn")),
    c("lbl-diag-dns", i("diag_dns")),
    c("lbl-diag-nat", i("diag_nat")),
    c("lbl-diag-suggest", i("diag_suggest")),
    w)
  )
    z();
  else {
    const n = document.getElementById("val-diag-suggest");
    n && (n.textContent = i("diag_initial_desc"));
  }
  (c("lbl-offline-mode", i("offline_mode")),
    c("btn-gen-local-sdp", i("offline_btn_gen")),
    k("txt-local-sdp", i("offline_local_placeholder")),
    c("lbl-remote-sdp", i("offline_remote_label")),
    k("txt-remote-sdp", i("offline_remote_placeholder")),
    c("btn-apply-remote-sdp", i("offline_btn_apply")),
    c("btn-verify-license", i("license_btn_verify")),
    k("license-input", i("license_placeholder")),
    c("lbl-smart-auto", i("smart_auto")),
    c("txt-auto-active", i("smart_auto_active_desc")),
    c("txt-sim-header", i("sim_advanced_header")),
    c("lbl-metric-rtt", i("metric_rtt")),
    c("lbl-metric-loss", i("metric_loss")),
    c("lbl-metric-protocol", i("metric_protocol")),
    c("lbl-metric-encryption", i("metric_encryption")),
    c("help-remote-id", i("help_remote_id")),
    c("help-access-pin", i("access_pin_help")),
    c("help-offline-sdp", i("help_offline_sdp")),
    c("help-license", i("help_license")),
    c("help-privacy", i("help_privacy")),
    c("help-sim", i("help_sim")),
    c("help-sim-rtt", i("help_sim_rtt")),
    c("help-sim-loss", i("help_sim_loss")),
    c("help-sim-relay", i("help_sim_relay")),
    c("help-smart-auto", i("help_smart_auto")));
  const o = document.getElementById("btn-copy-id");
  o && o.setAttribute("title", i("copy_tooltip"));
  const t = document.getElementById("btn-copy-hwid");
  t && t.setAttribute("title", i("copy_tooltip"));
  const a = document.getElementById("license-status");
  a &&
    (a.classList.contains("status-active")
      ? (a.textContent = i("status_active"))
      : (a.textContent = i("status_inactive")));
}
function c(e, o) {
  const t = document.getElementById(e);
  t && (t.textContent = o);
}
function k(e, o) {
  const t = document.getElementById(e);
  t && (t.placeholder = o);
}
async function oe() {
  if (!g()) {
    c("val-hwid", i("hwid_failed"));
    return;
  }
  try {
    const e = await m("get_device_hwid"),
      o = document.getElementById("val-hwid");
    o && ((o.textContent = e), (o.title = e));
  } catch (e) {
    (console.error("獲取 HWID 失敗:", e), c("val-hwid", i("hwid_failed")));
  }
}
function ae() {
  const e = document.getElementById("val-my-id"),
    o = () => Math.floor(100 + Math.random() * 900);
  let t = sessionStorage.getItem("2syn_my_id");
  return (
    t || ((t = `${o()}${o()}${o()}`), sessionStorage.setItem("2syn_my_id", t)),
    e && (e.textContent = `${t.slice(0, 3)}-${t.slice(3, 6)}-${t.slice(6)}`),
    t
  );
}
function F() {
  return String(Math.floor(1e5 + Math.random() * 9e5));
}
function ie() {
  const e = document.getElementById("val-my-pin"),
    o = document.getElementById("btn-refresh-pin"),
    t = document.getElementById("btn-copy-pin"),
    a = F();
  (e && (e.textContent = `${a.slice(0, 3)}-${a.slice(3)}`),
    (window.__localAccessPin = a),
    o &&
      e &&
      o.addEventListener("click", () => {
        const n = F();
        ((e.textContent = `${n.slice(0, 3)}-${n.slice(3)}`),
          (window.__localAccessPin = n),
          (R = n),
          (o.textContent = "✓"),
          setTimeout(() => {
            o.textContent = "🔄";
          }, 1e3));
      }),
    t &&
      e &&
      t.addEventListener("click", () => {
        const n = e.textContent || "";
        navigator.clipboard.writeText(n).then(() => {
          ((t.textContent = "✓"),
            setTimeout(() => {
              t.textContent = "📋";
            }, 1500));
        });
      }));
}
let C = null;
function J() {
  const e = Z();
  (console.log(`[Signaling] 嘗試連線到信令伺服器: ${e}`),
    (u = new WebSocket(e)),
    (u.onopen = () => {
      (console.log("[Signaling] 已連線，正在登入..."),
        u.send(JSON.stringify({ type: "login", id: j })),
        C && clearInterval(C),
        (C = setInterval(() => {
          u &&
            u.readyState === WebSocket.OPEN &&
            u.send(JSON.stringify({ type: "ping" }));
        }, 3e4)));
    }),
    (u.onmessage = async (o) => {
      let t;
      try {
        t = JSON.parse(o.data);
      } catch {
        return;
      }
      switch ((console.log("[Signaling] 收到:", t), t.type)) {
        case "offer":
          await le(t.source, t.sdp, t.pin);
          break;
        case "answer":
          if (p)
            try {
              (await p.setRemoteDescription(
                new RTCSessionDescription({ type: "answer", sdp: t.sdp }),
              ),
                console.log("[WebRTC] 遠端 Answer 已套用，ICE 協商中..."),
                se());
            } catch (a) {
              console.error("[WebRTC] 處理 Answer 失敗:", a);
            }
          break;
        case "ice":
          if (t.candidate !== void 0)
            if (p)
              if (p.remoteDescription)
                try {
                  const a = JSON.parse(t.candidate);
                  await p.addIceCandidate(a);
                } catch (a) {
                  console.warn("[WebRTC] 無法加入 ICE Candidate:", a);
                }
              else L.push(JSON.parse(t.candidate));
            else {
              if (t.candidate === "null" || t.candidate === "") break;
              if (!W) B.push(t.candidate);
              else
                try {
                  await m("add_ice_candidate_to_rust", {
                    candidateStr: t.candidate,
                  });
                } catch (a) {
                  console.warn("[WebRTC] 無法將 ICE Candidate 傳遞給 Rust:", a);
                }
            }
          break;
        case "error":
          (console.error("[Signaling] 伺服器錯誤:", t.message),
            t.message === "Target offline"
              ? (alert(
                  i("err_target_offline") ||
                    "對方不在線上，請確認設備 ID 是否正確。",
                ),
                S())
              : t.message.includes("Connection rejected") &&
                (alert("連線被拒絕：PIN 碼錯誤或對方拒絕連線。"), S()));
          break;
      }
    }),
    (u.onclose = () => {
      (console.warn("[Signaling] WebSocket 已斷線，5 秒後重新嘗試..."),
        (u = null),
        C && (clearInterval(C), (C = null)),
        setTimeout(J, 5e3));
    }),
    (u.onerror = (o) => {
      console.error("[Signaling] 連線錯誤:", o);
    }));
}
async function se() {
  if (p && p.remoteDescription)
    for (; L.length > 0; ) {
      const e = L.shift();
      try {
        await p.addIceCandidate(e);
      } catch (o) {
        console.warn("[WebRTC] 從佇列加入 ICE Candidate 失敗:", o);
      }
    }
}
function re(e) {
  (p && (p.close(), (p = null), (_ = null), (I = null), (L = [])), (E = e));
  const o = new RTCPeerConnection({ iceServers: N });
  return (
    (o.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE Connection State: ${o.iceConnectionState}`);
    }),
    (o.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection State: ${o.connectionState}`);
    }),
    (o.onicegatheringstatechange = () => {
      console.log(`[WebRTC] ICE Gathering State: ${o.iceGatheringState}`);
    }),
    (o.onsignalingstatechange = () => {
      console.log(`[WebRTC] Signaling State: ${o.signalingState}`);
    }),
    (o.onnegotiationneeded = () => {
      console.log("[WebRTC] Negotiation Needed");
    }),
    (o.onicecandidate = (t) => {
      (u == null ? void 0 : u.readyState) === WebSocket.OPEN &&
        u.send(
          JSON.stringify({
            type: "ice",
            target: e,
            candidate: JSON.stringify(t.candidate),
          }),
        );
    }),
    (o.onconnectionstatechange = () => {
      const t = o.connectionState;
      (console.log(`[WebRTC] 連線狀態: ${t}`), O(t));
    }),
    (o.ondatachannel = (t) => {
      const a = t.channel;
      a.label === "input-control"
        ? ((_ = a), x(a))
        : a.label === "file-transfer" && ((I = a), D(a));
    }),
    (o.ontrack = (t) => {
      if (
        (console.log("[WebRTC] 收到遠端視訊軌道:", t.track.kind),
        t.track.kind === "video")
      ) {
        const a = document.getElementById("remote-video"),
          n = document.querySelector(".glass-container"),
          s = document.getElementById("btn-mobile-keyboard");
        if (
          ((a.style.display = "block"),
          n && (n.style.display = "none"),
          ("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
            (s.style.display = "flex"),
          !a.srcObject)
        ) {
          ((a.srcObject =
            t.streams && t.streams.length > 0
              ? t.streams[0]
              : new MediaStream([t.track])),
            a.playoutDelayHint !== void 0 && (a.playoutDelayHint = 0),
            (a.playsInline = !0),
            (a.disablePictureInPicture = !0));
          try {
            (a.play(), Ce(a));
          } catch (r) {
            console.error("[WebRTC] 視訊播放失敗:", r);
          }
        }
      }
    }),
    o
  );
}
async function ce(e, o) {
  if (!u || u.readyState !== WebSocket.OPEN) {
    (alert(
      i("err_signaling_offline") ||
        "無法連線到信令伺服器，請確認 2syn 服務正在執行。",
    ),
      S());
    return;
  }
  try {
    const t = re(e);
    ((p = t),
      (_ = t.createDataChannel("input-control", {
        ordered: !0,
        maxRetransmits: 0,
      })),
      x(_),
      (I = t.createDataChannel("file-transfer", { ordered: !0 })),
      D(I),
      t.addTransceiver("video", { direction: "recvonly" }));
    const a = await t.createOffer();
    (await t.setLocalDescription(a),
      u.send(JSON.stringify({ type: "offer", target: e, pin: o, sdp: a.sdp })));
  } catch (t) {
    (console.error("[WebRTC] startCall 嚴重錯誤:", t),
      alert("建立連線失敗：" + String(t)),
      S());
  }
  console.log(`[WebRTC] Offer 已發送至 ${e}`);
}
async function le(e, o, t) {
  try {
    if (!!g()) {
      const n = await m("check_license_status");
      if (n.status === "expired" || n.status === "unauthorized") {
        (console.warn(`[WebRTC] 拒絕連線：被控端試用期已過期 (${n.status})`),
          alert(
            i("err_host_expired") ||
              "Host trial period has expired. Please enter a valid license key.",
          ),
          u &&
            u.readyState === WebSocket.OPEN &&
            u.send(
              JSON.stringify({
                type: "error",
                target: e,
                message: "Connection rejected: Host trial expired",
              }),
            ));
        return;
      }
    }
  } catch (a) {
    console.warn("授權狀態檢查失敗，為安全起見拒絕連線:", a);
    return;
  }
  if (((W = !1), (B = []), (E = e), t !== R)) {
    (console.warn(`[WebRTC] 拒絕連線：PIN 碼不符 (收到: ${t}, 預期: ${R})`),
      u &&
        u.readyState === WebSocket.OPEN &&
        u.send(
          JSON.stringify({
            type: "error",
            target: e,
            message: "Connection rejected",
          }),
        ));
    return;
  }
  try {
    console.log("[WebRTC] 交由 Rust 處理遠端 Offer...");
    const a = await m("handle_remote_offer_as_host", { offerSdp: o });
    for (
      (u == null ? void 0 : u.readyState) === WebSocket.OPEN &&
        u.send(JSON.stringify({ type: "answer", target: e, sdp: a })),
        console.log(`[WebRTC] Rust Answer 已回傳給 ${e}`),
        W = !0;
      B.length > 0;
    ) {
      const n = B.shift();
      if (n && n !== "null")
        try {
          await m("add_ice_candidate_to_rust", { candidateStr: n });
        } catch (s) {
          console.warn("[WebRTC] 從佇列傳遞 ICE Candidate 給 Rust 失敗:", s);
        }
    }
  } catch (a) {
    (console.error("[WebRTC] handle_remote_offer_as_host 發生嚴重錯誤:", a),
      alert("處理遠端連線要求時發生錯誤：" + String(a)));
  }
}
function x(e) {
  ((e.onopen = () => console.log("[DataChannel] input-control 已開啟")),
    (e.onclose = () => console.log("[DataChannel] input-control 已關閉")),
    (e.onmessage = async (o) => {
      try {
        const t =
          o.data instanceof ArrayBuffer
            ? new Uint8Array(o.data)
            : new Uint8Array(await o.data.arrayBuffer());
        await m("handle_remote_input", { data: Array.from(t) });
      } catch (t) {
        console.error("[Control] 執行遠端輸入失敗:", t);
      }
    }));
}
function D(e) {
  ((e.binaryType = "arraybuffer"),
    (e.onopen = () => console.log("[DataChannel] file-transfer 已開啟")),
    (e.onclose = () => console.log("[DataChannel] file-transfer 已關閉")),
    (e.onmessage = async (o) => {
      try {
        const t = new Uint8Array(o.data);
        await m("receive_file_chunk", { chunk: Array.from(t) });
      } catch (t) {
        console.error("[File] 寫入檔案塊失敗:", t);
      }
    }));
}
function S() {
  const e = document.getElementById("btn-connect"),
    o = document.getElementById("txt-btn-connect");
  (e && e.removeAttribute("disabled"),
    o && (o.textContent = i("btn_connect") || "Connect"));
  const t = document.getElementById("remote-video"),
    a = document.querySelector(".glass-container"),
    n = document.getElementById("btn-mobile-keyboard");
  (t && ((t.style.display = "none"), (t.srcObject = null)),
    a && (a.style.display = "flex"),
    n && (n.style.display = "none"));
}
function O(e) {
  const t = {
    connecting: i("conn_connecting") || "連線中...",
    connected: i("conn_connected") || "已連線 (P2P)",
    disconnected: i("conn_disconnected") || "已中斷",
    failed: i("conn_failed") || "連線失敗",
    closed: i("conn_closed") || "已關閉",
  }[e];
  if (t) {
    const a = document.getElementById("txt-btn-connect");
    if (a && e !== "connected") a.textContent = t;
    else if (a && e === "connected") {
      a.textContent = t;
      const n = document.getElementById("btn-connect");
      n && n.removeAttribute("disabled");
    }
  }
  e === "failed"
    ? (alert(
        i("err_rtc_failed") ||
          `P2P 連線失敗。
請確認雙方均已啟動 2syn，且防火牆允許 UDP 流量。`,
      ),
      S())
    : (e === "disconnected" || e === "closed") && S();
}
function de() {
  if (g()) {
    (A("rust-video-status", (n) => {
      console.error(`[WebRTC-Video] 影像處理發生問題: ${n.payload}`);
    }),
      A("rust-webrtc-state", (n) => {
        console.log(`[WebRTC-Rust] 狀態變更: ${n.payload}`);
      }));
    const a = document.getElementById("btn-fix-network");
    (a &&
      a.addEventListener("click", () => {
        (window.open("https://tailscale.com/download/mac", "_blank"),
          alert(`請下載並安裝 Tailscale，登入後即可獲得無限距穿透能力！
安裝完成後，此燈號會自動轉為綠色。`));
      }),
      A("rust-ice-candidate", (n) => {
        (console.log(
          "[WebRTC] 攔截到 Rust 產生的 ICE Candidate, 準備透過 WebSocket 轉發",
        ),
          u &&
            u.readyState === WebSocket.OPEN &&
            E &&
            u.send(
              JSON.stringify({
                type: "ice",
                target: E,
                candidate: JSON.stringify(n.payload),
              }),
            ));
      }));
  }
  const e = document.getElementById("btn-connect"),
    o = document.getElementById("remote-id-input"),
    t = document.getElementById("access-pin-input");
  !e ||
    !o ||
    !t ||
    e.addEventListener("click", async () => {
      const a = o.value.trim().replace(/-/g, ""),
        n = t.value.trim().replace(/-/g, "");
      if (!a || a.length !== 9) {
        alert(i("err_invalid_remote_id") || "請輸入有效的 9 位數設備 ID。");
        return;
      }
      if (!n || n.length < 4) {
        alert(i("err_invalid_pin") || "請輸入對方的存取 PIN 碼。");
        return;
      }
      e.setAttribute("disabled", "true");
      const s = document.getElementById("txt-btn-connect");
      (s && (s.textContent = i("connecting") || "Connecting..."),
        console.log(`[Frontend] 發起 WebRTC 連線至 ${a} (PIN: ${n})`),
        await ce(a, n));
    });
}
async function ue() {
  const e = document.getElementById("btn-verify-license"),
    o = document.getElementById("license-input"),
    t = document.getElementById("license-status");
  if (!g()) {
    (t &&
      ((t.className = "status-badge status-active"),
      (t.textContent = "Web Client")),
      o && o.setAttribute("disabled", "true"),
      e && e.setAttribute("disabled", "true"),
      console.log("[license] 純網頁環境，跳過本機授權檢查"));
    return;
  }
  if (t)
    try {
      const n = await m("check_license_status");
      n.status === "buyout"
        ? ((t.className = "status-badge status-active"),
          (t.textContent = i("status_active")),
          console.log("[license] 啟動時偵測到有效授權，已恢復狀態"))
        : n.status === "trial"
          ? ((t.className = "status-badge status-active"),
            (t.style.backgroundColor = "#eab308"),
            (t.style.color = "#ffffff"),
            (t.textContent = (
              i("status_trial") || "Trial ({0} days left)"
            ).replace("{0}", String(n.trial_days_left))),
            console.log(`[license] 試用期內，剩餘天數: ${n.trial_days_left}`))
          : n.status === "expired"
            ? ((t.className = "status-badge status-inactive"),
              (t.textContent = i("status_expired") || "Trial Expired"),
              console.log("[license] 試用已過期"))
            : ((t.className = "status-badge status-inactive"),
              (t.textContent = i("status_inactive")));
    } catch (n) {
      console.warn("[license] 啟動授權檢查失敗:", n);
    }
  e &&
    o &&
    t &&
    e.addEventListener("click", async () => {
      const n = o.value.trim();
      if (!n) {
        alert(i("err_license_empty") || "請輸入授權金鑰");
        return;
      }
      try {
        (await m("verify_license_key", { licenseKey: n }))
          ? ((t.className = "status-badge status-active"),
            (t.textContent = i("status_active")),
            alert(i("alert_license_success")))
          : ((t.className = "status-badge status-inactive"),
            (t.textContent = i("status_inactive")),
            alert(i("alert_license_fail")));
      } catch (s) {
        const r = String(s);
        let d = r;
        if (r.startsWith("err_limit_exceeded|")) {
          const f = r.split("|")[1] || "";
          d = i("err_limit_exceeded").replace("{0}", f);
        } else if (r.startsWith("err_cooldown_active|")) {
          const f = r.split("|")[1] || "10";
          d = i("err_cooldown_active").replace("{0}", f);
        } else if (r.startsWith("err_connect_server|")) {
          const f = r.split("|").slice(1).join("|");
          d = i("err_connect_server") + f;
        } else d = i(r);
        alert(`${i("alert_license_error")}${d}`);
      }
    });
}
function fe() {
  const e = document.getElementById("chk-privacy-mode");
  e &&
    e.addEventListener("change", async () => {
      if (!g()) {
        (alert("Web 模式下不支援實體防窺切換"), (e.checked = !e.checked));
        return;
      }
      try {
        const o = await m("toggle_privacy_mode", { enable: e.checked });
        console.log(o);
      } catch (o) {
        (console.error("切換隱私模式失敗:", o), (e.checked = !e.checked));
      }
    });
}
async function P() {
  const e = document.getElementById("range-rtt"),
    o = document.getElementById("range-loss"),
    t = document.getElementById("chk-sim-relay"),
    a = document.getElementById("val-sim-rtt"),
    n = document.getElementById("val-sim-loss");
  if (e && o && t) {
    const s = parseInt(e.value),
      r = parseFloat(o.value) / 100,
      d = t.checked;
    (a && (a.textContent = `${s} ms`), n && (n.textContent = `${o.value}%`));
    try {
      await m("trigger_network_simulation", {
        rttMs: s,
        lossRate: r,
        isRelay: d,
      });
    } catch (l) {
      console.error(l);
    }
  }
}
function me() {
  const e = document.getElementById("range-rtt"),
    o = document.getElementById("range-loss"),
    t = document.getElementById("chk-sim-relay"),
    a = document.getElementById("val-sim-rtt"),
    n = document.getElementById("val-sim-loss");
  e &&
    o &&
    t &&
    (e.addEventListener("input", (s) => {
      const r = s.target;
      (a && (a.textContent = `${r.value} ms`), P());
    }),
    o.addEventListener("input", (s) => {
      const r = s.target;
      (n && (n.textContent = `${r.value}%`), P());
    }),
    t.addEventListener("change", () => {
      P();
    }));
}
function pe() {
  g() &&
    setInterval(async () => {
      try {
        const e = await m("get_connection_status");
        c("val-metric-fps", `${e.target_fps} fps`);
        const o = i(e.color_format);
        (c("val-metric-color", o),
          c(
            "val-metric-bitrate",
            `${(e.bitrate_limit_kbps / 1e3).toFixed(1)} Mbps`,
          ));
        const t = e.file_transfer_enabled
          ? i("file_enabled")
          : i("file_disabled");
        (c("val-metric-file", t),
          c("val-metric-rtt", `${e.rtt_ms} ms`),
          c("val-metric-loss", `${(e.packet_loss_rate * 100).toFixed(1)}%`));
        const a =
          e.connection_type === "P2PDirect"
            ? i("protocol_p2p")
            : i("protocol_relay");
        c("val-metric-protocol", a);
        const n = i("encryption_gcu");
        c("val-metric-encryption", n);
      } catch (e) {
        if (typeof e == "string" && e.includes("not found")) return;
        console.error("狀態輪詢出錯:", e);
      }
    }, 500);
}
function ye() {
  const e = document.getElementById("chk-offline-sdp-mode"),
    o = document.getElementById("offline-sdp-panel"),
    t = document.getElementById("btn-gen-local-sdp"),
    a = document.getElementById("txt-local-sdp"),
    n = document.getElementById("btn-apply-remote-sdp"),
    s = document.getElementById("txt-remote-sdp");
  (e &&
    o &&
    e.addEventListener("change", () => {
      o.style.display = e.checked ? "flex" : "none";
    }),
    t &&
      a &&
      t.addEventListener("click", async () => {
        try {
          const r = new RTCPeerConnection({ iceServers: N });
          ((p = r),
            (E = "manual"),
            (_ = r.createDataChannel("input-control", {
              ordered: !0,
              maxRetransmits: 0,
            })),
            x(_),
            (I = r.createDataChannel("file-transfer", { ordered: !0 })),
            D(I),
            (r.onicecandidate = (l) => {
              var f;
              if (!l.candidate) {
                const y =
                  ((f = r.localDescription) == null ? void 0 : f.sdp) || "";
                ((a.value = y),
                  a.select(),
                  navigator.clipboard.writeText(y).catch(() => {}),
                  alert(i("alert_sdp_success")));
              }
            }),
            (r.onconnectionstatechange = () => O(r.connectionState)),
            (r.ondatachannel = (l) => {
              (l.channel.label === "input-control" && x(l.channel),
                l.channel.label === "file-transfer" && D(l.channel));
            }));
          const d = await r.createOffer();
          await r.setLocalDescription(d);
        } catch (r) {
          alert(`${i("alert_sdp_fail")}${String(r)}`);
        }
      }),
    n &&
      s &&
      n.addEventListener("click", async () => {
        var d;
        const r = s.value.trim();
        if (!r) {
          alert(i("alert_sdp_empty"));
          return;
        }
        try {
          if (
            p &&
            ((d = p.localDescription) == null ? void 0 : d.type) === "offer"
          )
            (await p.setRemoteDescription({ type: "answer", sdp: r }),
              alert(
                i("alert_sdp_applied") || "SDP Answer 已套用！ICE 協商中...",
              ));
          else {
            const l = new RTCPeerConnection({ iceServers: N });
            ((p = l),
              (E = "manual"),
              (l.onicecandidate = (y) => {
                var $;
                if (!y.candidate) {
                  const U =
                    (($ = l.localDescription) == null ? void 0 : $.sdp) || "";
                  ((a.value = U),
                    a.select(),
                    navigator.clipboard.writeText(U).catch(() => {}),
                    alert(
                      i("alert_answer_generated") ||
                        "Answer SDP 已產生並複製到剪貼板，請傳送給對方。",
                    ));
                }
              }),
              (l.onconnectionstatechange = () => O(l.connectionState)),
              (l.ondatachannel = (y) => {
                (y.channel.label === "input-control" && x(y.channel),
                  y.channel.label === "file-transfer" && D(y.channel));
              }),
              await l.setRemoteDescription({ type: "offer", sdp: r }));
            const f = await l.createAnswer();
            await l.setLocalDescription(f);
          }
        } catch (l) {
          alert(`${i("alert_sdp_apply_fail")}${String(l)}`);
        }
      }));
}
function ge() {
  const e = document.getElementById("btn-run-diagnostic");
  e &&
    e.addEventListener("click", async () => {
      const o = document.getElementById("val-diag-dns"),
        t = document.getElementById("val-diag-nat");
      if (
        (o && (o.textContent = i("diag_status_checking")),
        t && (t.textContent = i("diag_status_checking")),
        !g())
      ) {
        alert("Web 模式下不支援連線診斷功能");
        return;
      }
      try {
        ((w = await m("run_connection_diagnostic")), z());
      } catch (a) {
        const n = String(a),
          s = i(n);
        alert(`${i("alert_diag_failed")}${s}`);
      }
    });
}
function _e() {
  (document.querySelectorAll(".btn-info").forEach((o) => {
    o.addEventListener("click", (t) => {
      t.stopPropagation();
      const a = o.getAttribute("data-help");
      if (a) {
        const n = document.getElementById(`help-${a}`);
        if (n) {
          const s = n.classList.contains("show");
          (document.querySelectorAll(".help-block").forEach((r) => {
            r.classList.remove("show");
          }),
            s || n.classList.add("show"));
        }
      }
    });
  }),
    document.addEventListener("click", () => {
      document.querySelectorAll(".help-block").forEach((o) => {
        o.classList.remove("show");
      });
    }));
}
function he() {
  const e = document.getElementById("btn-copy-id"),
    o = document.getElementById("btn-copy-hwid"),
    t = document.getElementById("val-my-id"),
    a = document.getElementById("val-hwid");
  (e &&
    t &&
    e.addEventListener("click", () => {
      const n = t.textContent || "";
      navigator.clipboard
        .writeText(n)
        .then(() => {
          ((e.textContent = "✓"),
            setTimeout(() => {
              e.textContent = "📋";
            }, 1500));
        })
        .catch((s) => console.error("複製 ID 失敗:", s));
    }),
    o &&
      a &&
      o.addEventListener("click", () => {
        const n = a.textContent || "";
        navigator.clipboard
          .writeText(n)
          .then(() => {
            ((o.textContent = "✓"),
              setTimeout(() => {
                o.textContent = "📋";
              }, 1500));
          })
          .catch((s) => console.error("複製 HWID 失敗:", s));
      }));
}
function be() {
  const e = document.getElementById("chk-smart-auto"),
    o = document.getElementById("simulator-accordion"),
    t = document.getElementById("auto-status-indicator"),
    a = document.getElementById("range-rtt"),
    n = document.getElementById("range-loss"),
    s = document.getElementById("chk-sim-relay"),
    r = document.getElementById("val-sim-rtt"),
    d = document.getElementById("val-sim-loss");
  if (!e || !o || !t) return;
  const l = () => {
    e.checked
      ? (o.classList.remove("accordion-expanded"),
        o.classList.add("accordion-collapsed"),
        (t.style.display = "flex"),
        a && ((a.value = "10"), r && (r.textContent = "10 ms")),
        n && ((n.value = "0"), d && (d.textContent = "0%")),
        s && (s.checked = !1),
        P().catch((f) => console.error("同步最優網路狀態失敗:", f)))
      : (o.classList.remove("accordion-collapsed"),
        o.classList.add("accordion-expanded"),
        (t.style.display = "none"));
  };
  (e.addEventListener("change", l), l());
}
let T = null,
  v = null;
function we() {
  const e = document.getElementById("file-drop-zone"),
    o = document.getElementById("transfer-progress-container"),
    t = document.getElementById("transfer-filename"),
    a = document.getElementById("btn-cancel-transfer");
  e &&
    (e.addEventListener("dragover", (n) => {
      (n.preventDefault(),
        (e.style.borderColor = "var(--color-primary)"),
        (e.style.background = "var(--color-primary-glow)"));
    }),
    e.addEventListener("dragleave", (n) => {
      (n.preventDefault(),
        (e.style.borderColor = "var(--panel-border)"),
        (e.style.background = "rgba(0,0,0,0.02)"));
    }),
    e.addEventListener("drop", async (n) => {
      var d;
      (n.preventDefault(),
        (e.style.borderColor = "var(--panel-border)"),
        (e.style.background = "rgba(0,0,0,0.02)"));
      const s = (d = n.dataTransfer) == null ? void 0 : d.files;
      if (!s || s.length === 0) return;
      const r = s[0];
      if (
        (alert(
          "In a real Tauri app, we would use the absolute path of this file. PoC will simulate the transfer.",
        ),
        !g())
      ) {
        alert("Web 模式下不支援檔案傳輸");
        return;
      }
      try {
        const l = await m("send_file", { path: "/tmp/dummy_file.txt" });
        ((T = l),
          t && (t.textContent = r.name),
          o && (o.style.display = "flex"),
          ve(l));
      } catch (l) {
        alert(i(String(l)) || String(l));
      }
    }),
    a &&
      a.addEventListener("click", async () => {
        g() &&
          T &&
          (await m("cancel_transfer", { taskId: T }),
          (T = null),
          o && (o.style.display = "none"),
          v && clearInterval(v),
          alert("Transfer cancelled."));
      }));
}
function ve(e) {
  v && clearInterval(v);
  const o = document.getElementById("transfer-pct"),
    t = document.getElementById("transfer-progress-bar"),
    a = document.getElementById("transfer-progress-container");
  v = window.setInterval(async () => {
    if (g())
      try {
        const s = (await m("get_active_transfers")).find(
          (r) => r.task_id === e,
        );
        if (s) {
          const r = Math.round(s.progress_pct);
          (o && (o.textContent = `${r}%`),
            t && (t.style.width = `${r}%`),
            s.status === "Completed"
              ? (clearInterval(v),
                setTimeout(() => {
                  (a && (a.style.display = "none"),
                    alert("Transfer Complete!"));
                }, 1e3))
              : (s.status === "Cancelled" || s.status === "Failed") &&
                (clearInterval(v), a && (a.style.display = "none")));
        } else (clearInterval(v), a && (a.style.display = "none"));
      } catch (n) {
        if (typeof n == "string" && n.includes("not found")) return;
        console.error(n);
      }
  }, 1e3);
}
let H = 0,
  G = !1;
function h(e, o) {
  H++;
  const t = Date.now(),
    a = new Uint8Array(13 + o.length),
    n = new DataView(a.buffer);
  return (
    n.setUint32(0, H, !1),
    n.setUint32(4, Math.floor(t / 4294967296), !1),
    n.setUint32(8, t % 4294967296, !1),
    (a[12] = e),
    a.set(o, 13),
    a
  );
}
function b(e) {
  _ && _.readyState === "open" && _.send(e);
}
function Ce(e) {
  if (G) return;
  G = !0;
  const o = (n) => {
    const s = e.getBoundingClientRect();
    let r = (n.clientX - s.left) / s.width,
      d = (n.clientY - s.top) / s.height;
    ((r = Math.max(0, Math.min(1, r))), (d = Math.max(0, Math.min(1, d))));
    const l = new Uint8Array(8),
      f = new DataView(l.buffer);
    (f.setFloat32(0, r, !1), f.setFloat32(4, d, !1), b(h(1, l)));
  };
  (e.addEventListener("pointermove", (n) => {
    if ((n.preventDefault(), document.pointerLockElement === e)) {
      const s = Math.round(n.movementX),
        r = Math.round(n.movementY),
        d = new Uint8Array(8),
        l = new DataView(d.buffer);
      (l.setInt32(0, s, !1), l.setInt32(4, r, !1), b(h(7, d)));
    } else o(n);
  }),
    e.addEventListener("pointerdown", (n) => {
      (n.preventDefault(),
        window.matchMedia("(pointer: fine)").matches &&
          document.pointerLockElement !== e &&
          e.requestPointerLock(),
        document.pointerLockElement !== e && o(n));
      const s = new Uint8Array(1);
      let r = 1;
      (n.button === 2 && (r = 2),
        n.button === 1 && (r = 3),
        (s[0] = r),
        b(h(2, s)));
    }),
    e.addEventListener("pointerup", (n) => {
      n.preventDefault();
      const s = new Uint8Array(1);
      let r = 1;
      (n.button === 2 && (r = 2),
        n.button === 1 && (r = 3),
        (s[0] = r),
        b(h(3, s)));
    }),
    e.addEventListener("contextmenu", (n) => n.preventDefault()),
    window.addEventListener("keydown", (n) => {
      if (e.style.display === "none") return;
      const s = new Uint8Array(3),
        r = new DataView(s.buffer);
      let d = n.keyCode;
      ((d === 0 || d === 229) &&
        n.key &&
        n.key.length === 1 &&
        (d = n.key.toUpperCase().charCodeAt(0)),
        r.setUint16(0, d, !1));
      let l = 0;
      (n.shiftKey && (l |= 1),
        n.ctrlKey && (l |= 2),
        n.altKey && (l |= 4),
        n.metaKey && (l |= 8),
        (s[2] = l),
        b(h(4, s)));
    }),
    window.addEventListener("keyup", (n) => {
      if (e.style.display === "none") return;
      const s = new Uint8Array(3),
        r = new DataView(s.buffer);
      let d = n.keyCode;
      ((d === 0 || d === 229) &&
        n.key &&
        n.key.length === 1 &&
        (d = n.key.toUpperCase().charCodeAt(0)),
        r.setUint16(0, d, !1));
      let l = 0;
      (n.shiftKey && (l |= 1),
        n.ctrlKey && (l |= 2),
        n.altKey && (l |= 4),
        n.metaKey && (l |= 8),
        (s[2] = l),
        b(h(5, s)));
    }));
  const t = document.getElementById("btn-mobile-keyboard"),
    a = document.getElementById("hidden-keyboard-input");
  t &&
    a &&
    (t.addEventListener("click", () => {
      (a.focus(), (t.style.background = "rgba(0, 132, 255, 0.4)"));
    }),
    a.addEventListener("blur", () => {
      t.style.background = "rgba(255,255,255,0.2)";
    }),
    a.addEventListener("input", (n) => {
      if (n.inputType === "insertText" && n.data) {
        const r = n.data.toUpperCase().charCodeAt(0),
          d = new Uint8Array(3);
        (new DataView(d.buffer).setUint16(0, r, !1), (d[2] = 0), b(h(4, d)));
        const f = new Uint8Array(3);
        (new DataView(f.buffer).setUint16(0, r, !1),
          (f[2] = 0),
          b(h(5, f)),
          (a.value = ""));
      }
    }));
}
function Ie() {
  const e = document.getElementById("btn-toggle-panel"),
    o = document.getElementById("advanced-panel");
  e &&
    o &&
    e.addEventListener("click", () => {
      o.classList.toggle("panel-open");
    });
}
window.addEventListener("DOMContentLoaded", async () => {
  await te();
  const e = ae();
  (e && (j = e),
    await oe(),
    ie(),
    (R = window.__localAccessPin || ""),
    de(),
    ue(),
    fe(),
    me(),
    Ie(),
    ye(),
    ge(),
    _e(),
    he(),
    be(),
    we(),
    pe(),
    J());
});
