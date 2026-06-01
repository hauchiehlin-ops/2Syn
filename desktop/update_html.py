import re
import json

html_path = "index.html"
with open(html_path, "r", encoding="utf-8") as f:
    html = f.read()

replacements = {
    "NETWORK TRAVERSAL": "<span id=\"txt-network-traversal-title\">NETWORK TRAVERSAL</span>",
    "Tailscale interface detected. You now have 100% traversal rate through cellular and CGNAT networks for ultra-stable, high-speed connections.": "<span id=\"txt-network-traversal-desc-1\">Tailscale interface detected. You now have 100% traversal rate through cellular and CGNAT networks for ultra-stable, high-speed connections.</span>",
    "若不具備 TURN 伺服器，建議在雙端安裝免費的安全虛擬局域網工具 Tailscale，以 100% 實現 P2P 超低延遲直連。": "<span id=\"txt-network-traversal-desc-2\">若不具備 TURN 伺服器，建議在雙端安裝免費的安全虛擬局域網工具 Tailscale，以 100% 實現 P2P 超低延遲直連。</span>",
    "Run on System Startup": "<span id=\"txt-run-on-startup\">Run on System Startup</span>",
    "Run Diagnostics": "<span id=\"txt-run-diagnostics-btn\">Run Diagnostics</span>",
    "Network & Video Quality Metrics": "<span id=\"txt-network-metrics-title\">Network & Video Quality Metrics</span>",
    "Host Information": "<span id=\"txt-host-info-title-main\">Host Information</span>",
    "Security & Privacy": "<span id=\"txt-security-privacy-title\">Security & Privacy</span>",
    "System Logs": "<span id=\"txt-system-logs-title-main\">System Logs</span>",
    "Advanced Developer Tools": "<span id=\"txt-advanced-dev-title\">Advanced Developer Tools</span>",
    "Security & Connectivity Diagnostics": "<span id=\"txt-diag-title-main\">Security & Connectivity Diagnostics</span>",
    "My ID:": "<span id=\"txt-my-id-label\">My ID:</span>",
    "My MAC:": "<span id=\"txt-my-mac-label\">My MAC:</span>",
    "My HWID:": "<span id=\"txt-my-hwid-label\">My HWID:</span>",
    "Signaling Status:": "<span id=\"txt-signaling-status-label\">Signaling Status:</span>",
    "Static Access Password:": "<span id=\"txt-unattended-access-label\">Static Access Password:</span>",
    "STUN Server Lookup:": "<span id=\"txt-stun-lookup-label\">STUN Server Lookup:</span>",
    "NAT Detection Type:": "<span id=\"txt-nat-type-label\">NAT Detection Type:</span>",
    "Optimization Suggestions": "<span id=\"txt-opt-sug-label\">Optimization Suggestions</span>",
    "Click the button above to analyze your device secure store and connection pipes.": "<span id=\"txt-click-analyze-label\">Click the button above to analyze your device secure store and connection pipes.</span>",
    "Connection Protocol": "<span id=\"txt-conn-protocol-label\">Connection Protocol</span>",
    "Codec & Cipher Security": "<span id=\"txt-codec-sec-label\">Codec & Cipher Security</span>",
    "Actual FPS (Live)": "<span id=\"txt-actual-fps-label\">Actual FPS (Live)</span>",
    "Actual Bitrate (Live)": "<span id=\"txt-actual-bitrate-label\">Actual Bitrate (Live)</span>",
    "Network Latency (RTT)": "<span id=\"txt-net-lat-label\">Network Latency (RTT)</span>",
    "Packet Loss Rate": "<span id=\"txt-pkt-loss-label\">Packet Loss Rate</span>",
    "Simulated RTT Latency": "<span id=\"txt-sim-rtt-label\">Simulated RTT Latency</span>",
    "Simulated Packet Loss": "<span id=\"txt-sim-loss-label\">Simulated Packet Loss</span>",
    "Target Frame Rate": "<span id=\"txt-tgt-fps-label\">Target Frame Rate</span>",
    "Max Bitrate Limit": "<span id=\"txt-max-bit-label\">Max Bitrate Limit</span>",
    "Color Sampling": "<span id=\"txt-color-samp-label\">Color Sampling</span>",
    "Privacy Shield Mode (Virtual GPU)": "<span id=\"txt-priv-shield-label\">Privacy Shield Mode (Virtual GPU)</span>",
    "Smart Quality Auto-Optimization": "<span id=\"txt-smart-opt-label\">Smart Quality Auto-Optimization</span>",
    "Offline Connection (SDP)": "<span id=\"txt-offline-sdp-title\">Offline Connection (SDP)</span>",
    "Enter Remote SDP Answer/Offer": "<span id=\"txt-enter-sdp-label\">Enter Remote SDP Answer/Offer</span>",
    "Generate & Copy Local SDP Offer": "<span id=\"txt-gen-sdp-btn\">Generate & Copy Local SDP Offer</span>",
    "Force Play": "<span id=\"txt-force-play-btn\">Force Play</span>",
    "Import JSON": "<span id=\"txt-import-json-btn\">Import JSON</span>",
    "Export JSON": "<span id=\"txt-export-json-btn\">Export JSON</span>",
    "儲存並重新載入": "<span id=\"txt-save-reload-btn\">儲存並重新載入</span>",
    "進階：自攜 TURN 伺服器 (BYOI)": "<span id=\"txt-byoi-title\">進階：自攜 TURN 伺服器 (BYOI)</span>",
    "若您有自架 Coturn 等中繼伺服器，可在此輸入 JSON 陣列格式配置：": "<span id=\"txt-byoi-desc\">若您有自架 Coturn 等中繼伺服器，可在此輸入 JSON 陣列格式配置：</span>",
    "Mac / Windows 下載": "<span id=\"txt-dl-mac\">Mac / Windows 下載</span>",
    "iOS 下載 (App Store)": "<span id=\"txt-dl-ios\">iOS 下載 (App Store)</span>",
    "Android 下載": "<span id=\"txt-dl-android\">Android 下載</span>",
    "以上為被控端主機的即時除錯日誌。若包含 \"Screen capture failed\"，表示 Mac 主機雖勾選了權限，但仍被系統拒絕，請嘗試將該 App 權限取消勾選後重新勾選，並重啟 App。": "<span id=\"txt-logs-hint\">以上為被控端主機的即時除錯日誌。若包含 \"Screen capture failed\"，表示 Mac 主機雖勾選了權限，但仍被系統拒絕，請嘗試將該 App 權限取消勾選後重新勾選，並重啟 App。</span>",
    "重新發起系統授權提示": "<span id=\"txt-btn-reprompt\">重新發起系統授權提示</span>",
    "macOS 系統權限不足，將導致遠端控制黑屏！": "<span id=\"txt-permission-warning\">macOS 系統權限不足，將導致遠端控制黑屏！</span>",
    "被控端與主控端設備均需下載安裝。": "<span id=\"txt-dl-hint\">被控端與主控端設備均需下載安裝。</span>",
    "System automatically adjusting. Network and stream quality are in optimal states.": "<span id=\"txt-sys-auto-adj\">System automatically adjusting. Network and stream quality are in optimal states.</span>",
    "Simulate Relay Mode": "<span id=\"txt-sim-relay-mode\">Simulate Relay Mode</span>",
    "Network Traversal": "<span id=\"txt-network-health-title-2\">Network Traversal</span>",
}

for old, new in replacements.items():
    # Only replace if not already wrapped in <span id="..."> (naive check)
    if "id=\"txt-" not in html.split(old, 1)[0][-20:]:
        html = html.replace(">" + old + "<", ">" + new + "<")
        html = html.replace(">\n            " + old, ">\n            " + new)

with open(html_path, "w", encoding="utf-8") as f:
    f.write(html)

print("HTML IDs inserted.")
