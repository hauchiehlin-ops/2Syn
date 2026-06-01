import re

ts_path = "src/main.ts"
with open(ts_path, "r", encoding="utf-8") as f:
    content = f.read()

# Keys to add to fallbackTranslations
new_fallbacks = """
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
"""

# Inject into fallbackTranslations
content = content.replace("  \"first_run_btn_skip\": \"Set Later (Connections Will Be Rejected)\"", "  \"first_run_btn_skip\": \"Set Later (Connections Will Be Rejected)\",\n" + new_fallbacks)

# DOM updates
dom_updates = """
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
"""

# Inject into updateDomTranslations
content = content.replace("  setPlaceholder(\"access-pin-input\", t(\"access_pin_placeholder\"));", "  setPlaceholder(\"access-pin-input\", t(\"access_pin_placeholder\"));\n" + dom_updates)

# Also fix the dynamic string in main.ts around line 1335 "Excellent (P2P Ready)" etc
# wait, there's "Excellent (P2P Ready)" and "Fair (Relay Server)"
content = content.replace('"Excellent (P2P Ready)"', 't("ui_p2p_ready")')
content = content.replace('"Fair (Relay Server)"', 't("ui_relay_ready")')
content = content.replace('"Poor (Offline)"', 't("ui_offline")')
content = content.replace('      "ui_network_traversal": "NETWORK TRAVERSAL",', '      "ui_p2p_ready": "Excellent (P2P Ready)",\n  "ui_relay_ready": "Fair (Relay Server)",\n  "ui_offline": "Poor (Offline)",\n  "ui_network_traversal": "NETWORK TRAVERSAL",')

with open(ts_path, "w", encoding="utf-8") as f:
    f.write(content)

print("main.ts updated.")
