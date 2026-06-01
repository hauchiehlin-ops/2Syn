import os
import json

locales_dir = "/Users/barretlin/GitProjects/2syn/desktop/public/locales"
locale_files = [f for f in os.listdir(locales_dir) if f.endswith(".json")]

translations_zh_tw = {
    "host_info_title": "開放被控 (Control This Device)",
    "host_info_desc": "將這組 ID 與 PIN 碼提供給對方，以允許遠端連線。",
    "connect_title": "主控遠端裝置 (Control Remote Device)",
    "connect_desc": "輸入對方的夥伴 ID 以建立連線並控制其畫面。",
    "remote_id_placeholder": "輸入 9 碼 ID",
    "access_pin_placeholder": "輸入 PIN 碼",
    "no_recent_devices": "尚無最近連線裝置",
    "device_book": "裝置地址簿",
    "log_rust_ws_connected": "[Rust] 已成功建立 WebSocket 連線",
    "log_rust_login_success": "[Rust] 登入成功，ID: {0}"
}

translations_zh_cn = {
    "host_info_title": "开放被控 (Control This Device)",
    "host_info_desc": "将这组 ID 与 PIN 码提供给对方，以允许远端连线。",
    "connect_title": "主控远端装置 (Control Remote Device)",
    "connect_desc": "输入对方的伙伴 ID 以建立连线并控制其画面。",
    "remote_id_placeholder": "输入 9 码 ID",
    "access_pin_placeholder": "输入 PIN 码",
    "no_recent_devices": "暂无最近连接设备",
    "device_book": "设备地址簿",
    "log_rust_ws_connected": "[Rust] 已成功建立 WebSocket 连接",
    "log_rust_login_success": "[Rust] 登录成功，ID: {0}"
}

translations_en = {
    "host_info_title": "Control This Device",
    "host_info_desc": "Share this ID and PIN to allow remote connection.",
    "connect_title": "Control Remote Device",
    "connect_desc": "Enter partner ID to connect and control their screen.",
    "remote_id_placeholder": "Enter 9-digit ID",
    "access_pin_placeholder": "Enter PIN",
    "no_recent_devices": "No recent devices",
    "device_book": "DeviceBook",
    "log_rust_ws_connected": "[Rust] Successfully established WebSocket",
    "log_rust_login_success": "[Rust] Login Success, ID: {0}"
}

for filename in locale_files:
    filepath = os.path.join(locales_dir, filename)
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        # Decide which translations to apply
        if filename == "zh-TW.json":
            new_keys = translations_zh_tw
        elif filename == "zh-CN.json":
            new_keys = translations_zh_cn
        else:
            # Fallback to English for other locales
            new_keys = translations_en
            
        data.update(new_keys)
        
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Updated: {filename}")
    except Exception as e:
        print(f"Error updating {filename}: {e}")
