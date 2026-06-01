import re
import json

replacements = {
    'alert("匯入失敗：JSON 格式錯誤 (Failed to parse JSON)");': 'alert(t("alert_import_failed_json"));',
    'alert("JSON 格式錯誤，請確保輸入正確的陣列配置，例如: [{\\"urls\\":[\\"turn:ip:port\\"], \\"username\\":\\"u\\", \\"credential\\":\\"p\\"}]");': 'alert(t("alert_turn_json_error"));',
    'console.error(`無法載入語系檔 [${lang}]:`, error);': 'console.error(t("log_lang_load_failed"), lang, error);',
    'console.log(`[clipboard] 推送主控端剪貼簿至被控端: ${text.substring(0, 40)}`);': 'console.log(t("log_clip_push_client"), text.substring(0, 40));',
    'console.log(`[clipboard] 被控端剪貼簿變化，已推送: ${remoteText.substring(0, 40)}`);': 'console.log(t("log_clip_push_host"), remoteText.substring(0, 40));',
    'console.log("[Signaling] 使用者手動觸發信令重連...");': 'console.log(t("log_sig_manual_reconnect"));',
    'console.error("[Signaling] 重連失敗:", err);': 'console.error(t("log_sig_reconnect_failed"), err);',
    'console.log(`[Signaling] 嘗試連線到信令伺服器: ${url}`);': 'console.log(t("log_sig_trying"), url);',
    'console.log("[Signaling] 已連線，正在登入...");': 'console.log(t("log_sig_connected_logging_in"));',
    'console.warn("[Signaling] 偵測到計時器延遲（可能是系統 App Nap 凍結），主動關閉並重建連線...");': 'console.warn(t("log_sig_timer_delay"));',
    'console.log("[WebRTC] 遠端 Answer 已套用，ICE 協商中...");': 'console.log(t("log_webrtc_answer_applied"));',
    'console.log(`[WebRTC] 連線狀態: ${state}`);': 'console.log(t("log_webrtc_state"), state);',
    'console.warn("[WebRTC] 連線已建立但偵測不到視訊播放 (黑屏)。可能是自動播放受限，或遠端 macOS 未授權螢幕錄製。");': 'console.warn(t("log_webrtc_black_screen"));',
    'console.log(`[WebRTC] Offer 已發送至 ${remoteId}`);': 'console.log(t("log_webrtc_offer_sent"), remoteId);',
    'console.warn(`[WebRTC] 拒絕連線：被控端試用期已過期 (${licenseState.status})`);': 'console.warn(t("log_webrtc_trial_expired"), licenseState.status);',
    'console.warn(`[WebRTC] 拒絕連線：密碼不符或未設定密碼`);': 'console.warn(t("log_webrtc_pwd_mismatch"));',
    'console.log(`[Frontend] 發起 WebRTC 連線至 ${remoteId} (PIN: ${pin})`);': 'console.log(t("log_frontend_webrtc_init"), remoteId);',
    'console.log("[Signaling] 網頁控制端獲得焦點，且信令未連線，立即重建連線...");': 'console.log(t("log_sig_focus_reconnect"));',
    'console.log("[Signaling] 網頁控制端頁面恢復可見，且信令未連線，立即重建連線...");': 'console.log(t("log_sig_visible_reconnect"));',
    'console.log("[Signaling] 偵測為 Tauri 桌面環境，註冊 Rust 後端信令維護...");': 'console.log(t("log_sig_tauri_rust_reg"));',
    'console.log("[Signaling] [Rust] 嘗試連線至信令伺服器...");': 'console.log(t("log_sig_rust_trying"));',
    'console.log("[Signaling] [Rust] 已成功連線並登入信令伺服器。");': 'console.log(t("log_sig_rust_connected"));',
    'console.warn("[Signaling] [Rust] 與信令伺服器連線已斷開，準備重新嘗試連線...");': 'console.warn(t("log_sig_rust_disconnected"));',
    'console.log("[Signaling] 已成功委託 Rust 後端啟動信令客戶端。");': 'console.log(t("log_sig_rust_delegate_success"));',
    'console.error("[Signaling] 啟動 Rust 信令失敗:", err);': 'console.error(t("log_sig_rust_delegate_fail"), err);'
}

keys_zh = {
    "alert_import_failed_json": "匯入失敗：JSON 格式錯誤 (Failed to parse JSON)",
    "alert_turn_json_error": "JSON 格式錯誤，請確保輸入正確的陣列配置，例如: [{\"urls\":[\"turn:ip:port\"], \"username\":\"u\", \"credential\":\"p\"}]",
    "log_lang_load_failed": "無法載入語系檔",
    "log_clip_push_client": "[clipboard] 推送主控端剪貼簿至被控端:",
    "log_clip_push_host": "[clipboard] 被控端剪貼簿變化，已推送:",
    "log_sig_manual_reconnect": "[Signaling] 使用者手動觸發信令重連...",
    "log_sig_reconnect_failed": "[Signaling] 重連失敗:",
    "log_sig_trying": "[Signaling] 嘗試連線到信令伺服器:",
    "log_sig_connected_logging_in": "[Signaling] 已連線，正在登入...",
    "log_sig_timer_delay": "[Signaling] 偵測到計時器延遲（可能是系統 App Nap 凍結），主動關閉並重建連線...",
    "log_webrtc_answer_applied": "[WebRTC] 遠端 Answer 已套用，ICE 協商中...",
    "log_webrtc_state": "[WebRTC] 連線狀態:",
    "log_webrtc_black_screen": "[WebRTC] 連線已建立但偵測不到視訊播放 (黑屏)。可能是自動播放受限，或遠端 macOS 未授權螢幕錄製。",
    "log_webrtc_offer_sent": "[WebRTC] Offer 已發送至",
    "log_webrtc_trial_expired": "[WebRTC] 拒絕連線：被控端試用期已過期",
    "log_webrtc_pwd_mismatch": "[WebRTC] 拒絕連線：密碼不符或未設定密碼",
    "log_frontend_webrtc_init": "[Frontend] 發起 WebRTC 連線至",
    "log_sig_focus_reconnect": "[Signaling] 網頁控制端獲得焦點，且信令未連線，立即重建連線...",
    "log_sig_visible_reconnect": "[Signaling] 網頁控制端頁面恢復可見，且信令未連線，立即重建連線...",
    "log_sig_tauri_rust_reg": "[Signaling] 偵測為 Tauri 桌面環境，註冊 Rust 後端信令維護...",
    "log_sig_rust_trying": "[Signaling] [Rust] 嘗試連線至信令伺服器...",
    "log_sig_rust_connected": "[Signaling] [Rust] 已成功連線並登入信令伺服器。",
    "log_sig_rust_disconnected": "[Signaling] [Rust] 與信令伺服器連線已斷開，準備重新嘗試連線...",
    "log_sig_rust_delegate_success": "[Signaling] 已成功委託 Rust 後端啟動信令客戶端。",
    "log_sig_rust_delegate_fail": "[Signaling] 啟動 Rust 信令失敗:"
}

keys_en = {
    "alert_import_failed_json": "Import Failed: Invalid JSON format",
    "alert_turn_json_error": "Invalid JSON format. Please ensure correct array configuration.",
    "log_lang_load_failed": "Failed to load language file",
    "log_clip_push_client": "[clipboard] Pushing client clipboard to host:",
    "log_clip_push_host": "[clipboard] Host clipboard changed, pushed:",
    "log_sig_manual_reconnect": "[Signaling] User manually triggered reconnect...",
    "log_sig_reconnect_failed": "[Signaling] Reconnection failed:",
    "log_sig_trying": "[Signaling] Attempting to connect to signaling server:",
    "log_sig_connected_logging_in": "[Signaling] Connected, logging in...",
    "log_sig_timer_delay": "[Signaling] Timer delay detected (possible App Nap), reconnecting...",
    "log_webrtc_answer_applied": "[WebRTC] Remote Answer applied, negotiating ICE...",
    "log_webrtc_state": "[WebRTC] Connection state:",
    "log_webrtc_black_screen": "[WebRTC] Connected but no video detected (Black screen). Check macOS Screen Recording permissions.",
    "log_webrtc_offer_sent": "[WebRTC] Offer sent to",
    "log_webrtc_trial_expired": "[WebRTC] Connection rejected: Trial expired",
    "log_webrtc_pwd_mismatch": "[WebRTC] Connection rejected: Password mismatch or not set",
    "log_frontend_webrtc_init": "[Frontend] Initiating WebRTC connection to",
    "log_sig_focus_reconnect": "[Signaling] Client gained focus, signaling offline, reconnecting...",
    "log_sig_visible_reconnect": "[Signaling] Client page visible, signaling offline, reconnecting...",
    "log_sig_tauri_rust_reg": "[Signaling] Tauri desktop environment detected, registering Rust signaling...",
    "log_sig_rust_trying": "[Signaling] [Rust] Attempting to connect to signaling server...",
    "log_sig_rust_connected": "[Signaling] [Rust] Successfully connected and logged in.",
    "log_sig_rust_disconnected": "[Signaling] [Rust] Disconnected from signaling server, retrying...",
    "log_sig_rust_delegate_success": "[Signaling] Successfully delegated Rust to start signaling client.",
    "log_sig_rust_delegate_fail": "[Signaling] Failed to start Rust signaling:"
}

with open('desktop/src/main.ts', 'r', encoding='utf-8') as f:
    content = f.read()

for old_str, new_str in replacements.items():
    content = content.replace(old_str, new_str)

with open('desktop/src/main.ts', 'w', encoding='utf-8') as f:
    f.write(content)

# Update locales
for lang, new_keys in [('zh-TW', keys_zh), ('en', keys_en)]:
    with open(f'desktop/public/locales/{lang}.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    data.update(new_keys)
    with open(f'desktop/public/locales/{lang}.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

print("Logs translated successfully.")
