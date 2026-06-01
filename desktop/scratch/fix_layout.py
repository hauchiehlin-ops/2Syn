import re

with open('desktop/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

new_html = """
      <!-- 左側控制面板 -->
      <section class="control-panel glass-panel" style="display: flex; gap: 24px; padding: 16px; width: 100%; max-width: 900px; margin: 0 auto; flex-direction: row; flex-wrap: wrap; box-sizing: border-box;">
        
        <!-- 左半邊：本機身分與授權 -->
        <div class="host-col" style="flex: 1; min-width: 300px; display: flex; flex-direction: column; gap: 16px;">
          <div class="host-info" id="local-host-info-section" style="background: rgba(16, 185, 129, 0.05); padding: 16px; border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.2);">
            <!-- macOS Permission Warning Banner -->
            <div id="permission-warning-banner" class="alert-banner-mac" style="display: none;">
              <span class="warning-icon">⚠️</span>
              <span id="txt-permission-warning" style="flex: 1;">macOS 系統權限不足，將導致遠端控制黑屏！</span>
              <button id="btn-fix-permissions" class="btn-fix-perm" type="button">如何解決</button>
            </div>
            
            <h3 id="txt-host-info-title" data-i18n="host_info_title" style="margin-top: 0; margin-bottom: 4px; font-size: 18px; color: var(--success-color, #10b981);">Control This Device (Host)</h3>
            <p style="font-size: 12px; color: var(--text-muted); margin-top: 0; margin-bottom: 12px;" data-i18n="host_info_desc">Share this ID and PIN to allow remote connection.</p>
            
            <div class="info-row">
              <span id="lbl-signaling-status">Signaling Status:</span>
              <div class="val-with-copy">
                <span id="val-signaling-status" class="status-badge status-inactive" style="margin-top: 0;">Offline</span>
                <button class="btn-copy" id="btn-reconnect-signaling" type="button" title="Reconnect Signaling">🔄</button>
              </div>
            </div>
            <div class="info-row">
              <span id="lbl-my-id">My ID:</span>
              <div class="val-with-copy">
                <span id="val-my-id" class="code-text" style="font-size: 16px; font-weight: 800; color: var(--text-main); background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 6px;">Loading...</span>
                <button class="btn-copy" id="btn-copy-id" type="button" title="Copy">📋</button>
              </div>
            </div>
            <div class="info-row">
              <span id="lbl-my-mac">My MAC:</span>
              <div class="val-with-copy">
                <span id="val-my-mac" class="code-text">Loading...</span>
                <button class="btn-copy" id="btn-copy-mac" type="button" title="Copy">📋</button>
              </div>
            </div>
            <div class="info-row">
              <span id="lbl-hwid">My HWID:</span>
              <div class="val-with-copy">
                <span id="val-hwid" class="code-text truncate">Loading...</span>
                <button class="btn-copy" id="btn-copy-hwid" type="button" title="Copy">📋</button>
              </div>
            </div>
            <div class="info-row" style="flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color); width: 100%;">
              <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span id="lbl-static-pwd" style="font-size: 13px; font-weight: 500;">Static Access Password:</span>
                <span id="static-pwd-status-badge" class="status-badge status-inactive" style="margin-top: 0;">Not Set</span>
              </div>
              <div style="position: relative; display: flex; width: 100%; gap: 6px;">
                <div style="position: relative; flex: 1; display: flex; align-items: center;">
                  <input type="password" id="input-static-pwd" placeholder="Set Unattended Password" style="width: 100%; padding-right: 55px; box-sizing: border-box;">
                  <button id="btn-toggle-static-pwd" type="button" class="btn-copy" style="position: absolute; right: 8px; font-size: 11px; padding: 2px 6px; background: rgba(255, 255, 255, 0.08); border-radius: 4px; color: var(--text-muted); cursor: pointer; border: none;" title="Toggle visibility">Show</button>
                </div>
                <button id="btn-set-static-pwd" class="btn-secondary" style="padding: 6px 12px; flex-shrink: 0;">Save</button>
                <button id="btn-delete-static-pwd" class="btn-secondary" style="padding: 6px 12px; flex-shrink: 0; background: var(--color-danger-bg, rgba(230, 45, 65, 0.1)); color: var(--color-danger, #e62d41); border: 1px solid rgba(230, 45, 65, 0.2); display: none;">Delete</button>
              </div>
            </div>
            
            <div class="input-group license-group">
              <label for="license-input">
                <span id="lbl-license">Buyout License Key</span>
                <button class="btn-info" data-help="license" type="button">ⓘ</button>
              </label>
              <div id="help-license" class="help-block"></div>
              <div class="input-with-button">
                <input type="password" id="license-input" placeholder="Enter license key">
                <button id="btn-verify-license" class="btn-secondary">Verify</button>
              </div>
              <span id="license-status" class="status-badge status-inactive">Unauthorized</span>
            </div>
          </div>
        </div>

        <div class="separator-horizontal" style="height: 1px; width: 100%; background: var(--panel-border); margin: 4px 0; display: none;"></div>

        <!-- 右半邊：建立遠端連線與其他 -->
        <div class="client-col" style="flex: 1; min-width: 300px; display: flex; flex-direction: column; gap: 16px;">
          <!-- 建立遠端連線 -->
          <div id="client-connection-section" style="background: rgba(59, 130, 246, 0.05); padding: 16px; border-radius: 12px; border: 1px solid rgba(59, 130, 246, 0.2);">
            <h2 id="txt-connect-title" data-i18n="connect_title" style="margin-top: 0; margin-bottom: 4px; font-size: 18px; color: var(--accent-color, #3b82f6);">Control Remote Device</h2>
            <p style="font-size: 12px; color: var(--text-muted); margin-top: 0; margin-bottom: 16px;" data-i18n="connect_desc">Enter partner ID to connect and control their screen.</p>
            
            <form id="connect-form" action="#" onsubmit="return false;">
              <div class="input-group">
                <label for="remote-id-input">
                  <span id="lbl-remote-id">Remote Device ID</span>
                  <button class="btn-info" data-help="remote-id" type="button">ⓘ</button>
                </label>
                <div id="help-remote-id" class="help-block"></div>
                <input type="text" id="remote-id-input" name="remote-id" placeholder="Enter 9-digit Device ID" autocomplete="username" maxlength="11" data-i18n-placeholder="remote_id_placeholder" style="font-size: 16px; padding: 12px;">
              </div>

              <div class="input-group">
                <label for="access-pin-input">
                  <span id="lbl-access-pin">Access PIN</span>
                  <button class="btn-info" data-help="access-pin" type="button">ⓘ</button>
                </label>
                <div id="help-access-pin" class="help-block"></div>
                <div style="position: relative; display: flex; align-items: center; width: 100%;">
                  <input type="password" id="access-pin-input" name="access-pin" placeholder="Enter access PIN" autocomplete="current-password" style="padding-right: 60px; width: 100%; font-size: 14px; padding: 12px;" data-i18n-placeholder="access_pin_placeholder">
                  <button id="btn-toggle-pin" type="button" style="position: absolute; right: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer; color: var(--text-main); min-width: 50px; text-align: center;">Show</button>
                </div>
              </div>

              <button id="btn-connect" type="submit" class="btn-primary" style="margin-top: 8px;">
                <span id="txt-btn-connect">Connect</span>
              </button>
            </form>
          </div>

          <!-- 地址簿 / 裝置清單 -->
          <div id="device-book-section" class="panel-section">
            <div id="device-book-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding-bottom: 6px; border-bottom: 1px solid var(--panel-border, rgba(255,255,255,0.08));" onclick="toggleDeviceBook()">
              <h3 id="txt-device-book-title" data-i18n="device_book" style="margin: 0; font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Saved Devices</h3>
              <span id="device-book-toggle-icon" style="font-size: 11px; color: var(--text-secondary); transition: transform 0.2s;">&#9660;</span>
            </div>
            <div id="device-book-content" style="display: none; margin-top: 8px;">
              <div id="device-book-list" style="display: flex; flex-direction: column; gap: 6px;">
                <!-- dynamically populated -->
              </div>
              <p id="device-book-empty-msg" data-i18n="no_recent_devices" style="font-size: 12px; color: var(--text-secondary); text-align: center; padding: 12px 0; display: none;">No recent devices</p>
              
              <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                <button id="btn-import-device-book" class="btn-secondary" style="padding: 4px 8px; font-size: 11px;">Import JSON</button>
                <button id="btn-export-device-book" class="btn-secondary" style="padding: 4px 8px; font-size: 11px;">Export JSON</button>
              </div>
              <input type="file" id="input-import-device-book" accept=".json" style="display: none;" />
            </div>
          </div>

          <!-- 去中心化離線手動 SDP 連線 -->
          <div class="offline-sdp-section">
            <div class="toggle-row">
              <span style="font-weight: 600; font-size: 13px; display: inline-flex; align-items: center;">
                <span id="lbl-offline-mode">Offline Connection (SDP)</span>
                <button class="btn-info" data-help="offline-sdp" type="button">ⓘ</button>
              </span>
              <label class="switch">
                <input type="checkbox" id="chk-offline-sdp-mode">
                <span class="slider round"></span>
              </label>
            </div>
            <div id="help-offline-sdp" class="help-block"></div>
            <div id="offline-sdp-panel" class="offline-panel-hidden" style="display: none; flex-direction: column; gap: 10px; margin-top: 10px;">
              <button id="btn-gen-local-sdp" class="btn-secondary">Generate & Copy Local SDP Offer</button>
              <textarea id="txt-local-sdp" readonly placeholder="Local SDP will be generated here" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); color: var(--text-main); font-family: monospace; font-size: 11px; padding: 6px; border-radius: 6px; height: 70px; resize: none;"></textarea>
              
              <label for="txt-remote-sdp" id="lbl-remote-sdp" style="font-size: 11px; color: var(--text-muted);">Enter Remote SDP Answer/Offer</label>
              <textarea id="txt-remote-sdp" placeholder="Paste Remote SDP here" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); color: var(--text-main); font-family: monospace; font-size: 11px; padding: 6px; border-radius: 6px; height: 70px; resize: none;"></textarea>
              <button id="btn-apply-remote-sdp" class="btn-primary" style="padding: 8px;">Establish Connection</button>
            </div>
          </div>

          <!-- 網路體質自動診斷 -->
          <div class="network-health-section">
            <h3 id="txt-network-health-title" style="font-size: 12px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Network Traversal</h3>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span id="network-health-indicator" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: var(--text-muted);"></span>
                <span id="network-health-text" style="font-size: 13px; font-weight: 500;">Checking...</span>
              </div>
              <button id="btn-fix-network" class="btn-primary" style="display: none; padding: 4px 10px; font-size: 12px; height: auto;">🚀 Enable Relay Mode</button>
            </div>
            <p id="network-health-desc" style="font-size: 12px; color: var(--text-muted); margin-top: 8px; line-height: 1.4;"></p>
          </div>

          <!-- 隱私功能 -->
          <div class="privacy-control">
            <h3 id="txt-privacy-title">Security & Privacy</h3>
            <div class="toggle-row">
              <span style="display: inline-flex; align-items: center;">
                <span id="lbl-privacy-mode">Privacy Shield Mode (Virtual GPU)</span>
                <button class="btn-info" data-help="privacy" type="button">ⓘ</button>
              </span>
              <label class="switch">
                <input type="checkbox" id="chk-privacy-mode">
                <span class="slider round"></span>
              </label>
            </div>
            
            <div class="toggle-row host-only" style="margin-top: 10px;">
              <span style="display: inline-flex; align-items: center;">
                <span id="lbl-autostart">Run on System Startup</span>
              </span>
              <label class="switch">
                <input type="checkbox" id="chk-autostart">
                <span class="slider round"></span>
              </label>
            </div>
            <div id="help-privacy" class="help-block"></div>
          </div>
        </div>

        <style>
          @media (max-width: 768px) {
            .control-panel {
              flex-direction: column !important;
            }
            .separator-horizontal {
              display: block !important;
            }
          }
        </style>
      </section>
"""

start_str = '      <!-- 左側控制面板 -->\n      <section class="control-panel glass-panel">'
end_str = '      </section>'

start_idx = content.find(start_str)
end_idx = content.find(end_str, start_idx) + len(end_str)

if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + new_html.strip() + content[end_idx:]
    with open('desktop/index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully replaced layout section.")
else:
    print("Failed to find boundaries.")
