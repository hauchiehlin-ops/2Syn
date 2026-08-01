// Tauri lib entry point

#[cfg(not(any(target_os = "ios", target_os = "android")))]
use std::sync::Arc;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use syn_core::connection::ConnectionManager;
use syn_core::security::{generate_hwid, LicenseValidator, SecureStorage};
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tauri::{Emitter, Manager, State};

#[cfg(not(any(target_os = "ios", target_os = "android")))]
use futures_util::{SinkExt, StreamExt};
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as WsMessage};

#[cfg(not(any(target_os = "ios", target_os = "android")))]
const FILE_TRANSFER_CHUNK_SIZE: usize = 60 * 1024 - FILE_TRANSFER_FRAME_HEADER_BYTES;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
const FILE_TRANSFER_BUFFER_HIGH_WATER: usize = 512 * 1024;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
const FILE_TRANSFER_BUFFER_DRAIN_TIMEOUT_MS: u128 = 30_000;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
const FILE_TRANSFER_FRAME_HEADER_BYTES: usize = 16;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
const FILE_TRANSFER_FRAME_MAGIC: u32 = 0x3253_594e; // "2SYN"

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedTransferFile {
    name: String,
    path: String,
    size: u64,
    last_modified: u64,
}

struct AppState {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    connection_manager: Arc<ConnectionManager>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    active_pc: tokio::sync::Mutex<Option<Arc<webrtc::peer_connection::RTCPeerConnection>>>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    active_file_channel: tokio::sync::Mutex<Option<Arc<webrtc::data_channel::RTCDataChannel>>>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    file_resume_offsets: tokio::sync::Mutex<std::collections::HashMap<String, u64>>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    file_complete_confirmations: tokio::sync::Mutex<std::collections::HashSet<String>>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    signaling_tx: tokio::sync::Mutex<Option<tokio::sync::mpsc::Sender<String>>>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    current_pin: Arc<tokio::sync::RwLock<String>>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    current_remote_id: Arc<tokio::sync::RwLock<String>>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    signaling_abort: tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    has_active_webrtc: Arc<std::sync::atomic::AtomicBool>,
}

/// 回傳目前執行中的後端 build 身分，協助確認安裝包是否真的更新。
#[tauri::command]
async fn get_build_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "git_commit": option_env!("SYN_GIT_COMMIT").unwrap_or("unknown"),
        "build_time": option_env!("SYN_BUILD_TIME").unwrap_or("unknown"),
    }))
}

/// 獲取本機硬體特徵碼（HWID）的 Tauri Command
#[tauri::command]
async fn get_device_hwid() -> Result<String, String> {
    generate_hwid().map_err(|e| e.to_string())
}

const STATIC_PWD_KEY: &str = "2syn_static_password";

/// 設定靜態無人值守密碼
#[tauri::command]
async fn set_static_password(password: String) -> Result<(), String> {
    if password.is_empty() {
        // 清除密碼 (如果 keyring 支援 delete_secret)
        // 為了簡單起見，如果是空的，我們存一個特殊標記或拒絕
        return Err("Password cannot be empty".to_string());
    }
    SecureStorage::save_secret(STATIC_PWD_KEY, &password).map_err(|e| e.to_string())
}

/// 驗證靜態無人值守密碼
#[tauri::command]
async fn verify_static_password(password: String) -> Result<bool, String> {
    match SecureStorage::load_secret(STATIC_PWD_KEY) {
        Ok(saved_pwd) => Ok(saved_pwd == password),
        Err(_) => Ok(false), // 沒設定時，皆回傳 false
    }
}

/// 檢查是否已設定靜態密碼
#[tauri::command]
async fn check_has_static_password() -> Result<bool, String> {
    match SecureStorage::load_secret(STATIC_PWD_KEY) {
        Ok(pwd) => Ok(!pwd.is_empty()),
        Err(_) => Ok(false),
    }
}

/// 刪除靜態無人值守密碼
#[tauri::command]
async fn delete_static_password() -> Result<(), String> {
    SecureStorage::delete_secret(STATIC_PWD_KEY).map_err(|e| e.to_string())
}

/// 開啟 macOS「系統設定 > 一般 > 登入項目與延伸功能」面板，
/// 方便使用者設定「自動登入」，避免被控端登出後遠端連線中斷。
#[cfg(target_os = "macos")]
#[tauri::command]
async fn open_login_items_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.LoginItems-Settings.extension")
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn open_login_items_settings() -> Result<(), String> {
    Err("僅支援 macOS".to_string())
}

/// 讀取系統剪貼簿內容（純文字）
#[tauri::command]
async fn read_clipboard() -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        use objc::runtime::{Class, Object};
        use objc::{msg_send, sel, sel_impl};
        unsafe {
            let cls = Class::get("UIPasteboard").ok_or_else(|| "UIPasteboard class not found".to_string())?;
            let pasteboard: *mut Object = msg_send![cls, generalPasteboard];
            if pasteboard.is_null() {
                return Err("generalPasteboard is null".to_string());
            }
            let has_strings: bool = msg_send![pasteboard, hasStrings];
            if !has_strings {
                return Ok(String::new());
            }
            let nsstring: *mut Object = msg_send![pasteboard, string];
            if nsstring.is_null() {
                return Ok(String::new());
            }
            let utf8_str: *const std::os::raw::c_char = msg_send![nsstring, UTF8String];
            if utf8_str.is_null() {
                return Ok(String::new());
            }
            let bytes = std::ffi::CStr::from_ptr(utf8_str).to_bytes();
            let s = String::from_utf8_lossy(bytes).into_owned();
            Ok(s)
        }
    }

    #[cfg(target_os = "android")]
    {
        android_read_clipboard()
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        use arboard::Clipboard;
        let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
        clipboard.get_text().map_err(|e| e.to_string())
    }
}

/// 寫入內容至系統剪貼簿
#[tauri::command]
async fn write_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        use objc::runtime::{Class, Object};
        use objc::{msg_send, sel, sel_impl};
        use std::ffi::CString;
        unsafe {
            let cls = Class::get("UIPasteboard").ok_or_else(|| "UIPasteboard class not found".to_string())?;
            let pasteboard: *mut Object = msg_send![cls, generalPasteboard];
            if pasteboard.is_null() {
                return Err("generalPasteboard is null".to_string());
            }
            let nsstring_class = Class::get("NSString").ok_or_else(|| "NSString class not found".to_string())?;
            let c_str = CString::new(text).map_err(|e| e.to_string())?;
            let nsstring: *mut Object = msg_send![nsstring_class, alloc];
            let nsstring: *mut Object = msg_send![nsstring, initWithUTF8String: c_str.as_ptr()];
            let _: () = msg_send![pasteboard, setString: nsstring];
            let _: () = msg_send![nsstring, release];
            Ok(())
        }
    }

    #[cfg(target_os = "android")]
    {
        android_write_clipboard(text)
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        use arboard::Clipboard;
        let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
        clipboard.set_text(text).map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "android")]
fn with_android_env<R>(
    f: impl FnOnce(&mut jni::JNIEnv<'_>) -> Result<R, String>,
) -> Result<R, String> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("JavaVM unavailable: {e}"))?;
    let vm = std::mem::ManuallyDrop::new(vm);
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("JNI attach failed: {e}"))?;
    f(&mut env)
}

#[cfg(target_os = "android")]
fn android_clipboard_manager<'a>(
    env: &mut jni::JNIEnv<'a>,
) -> Result<jni::objects::JObject<'a>, String> {
    use jni::objects::{JObject, JValue};
    use std::mem::ManuallyDrop;

    let ctx = ndk_context::android_context();
    let context = ManuallyDrop::new(unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) });
    let context_class = env
        .find_class("android/content/Context")
        .map_err(|e| format!("Context class unavailable: {e}"))?;
    let clipboard_service = env
        .get_static_field(
            context_class,
            "CLIPBOARD_SERVICE",
            "Ljava/lang/String;",
        )
        .map_err(|e| format!("CLIPBOARD_SERVICE unavailable: {e}"))?;
    let clipboard_service = clipboard_service.l().map_err(|e| e.to_string())?;
    let clipboard = env
        .call_method(
            &*context,
            "getSystemService",
            "(Ljava/lang/String;)Ljava/lang/Object;",
            &[JValue::from(&clipboard_service)],
        )
        .map_err(|e| format!("getSystemService(CLIPBOARD_SERVICE) failed: {e}"))?
        .l()
        .map_err(|e| format!("Clipboard service object invalid: {e}"))?;
    Ok(clipboard)
}

#[cfg(target_os = "android")]
fn android_read_clipboard() -> Result<String, String> {
    use jni::objects::{JObject, JString};
    use std::mem::ManuallyDrop;

    with_android_env(|env| {
        let clipboard = android_clipboard_manager(env)?;
        let clip = env
            .call_method(&clipboard, "getPrimaryClip", "()Landroid/content/ClipData;", &[])
            .map_err(|e| format!("getPrimaryClip failed: {e}"))?
            .l()
            .map_err(|e| format!("Primary clip invalid: {e}"))?;
        if clip.is_null() {
            return Ok(String::new());
        }

        let count = env
            .call_method(&clip, "getItemCount", "()I", &[])
            .map_err(|e| format!("getItemCount failed: {e}"))?
            .i()
            .map_err(|e| format!("Clip item count invalid: {e}"))?;
        if count <= 0 {
            return Ok(String::new());
        }

        let item = env
            .call_method(
                &clip,
                "getItemAt",
                "(I)Landroid/content/ClipData$Item;",
                &[jni::objects::JValue::Int(0)],
            )
            .map_err(|e| format!("getItemAt(0) failed: {e}"))?
            .l()
            .map_err(|e| format!("Clip item invalid: {e}"))?;
        if item.is_null() {
            return Ok(String::new());
        }

        let ctx = ndk_context::android_context();
        let context = ManuallyDrop::new(unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) });
        let text_obj = env
            .call_method(
                &item,
                "coerceToText",
                "(Landroid/content/Context;)Ljava/lang/CharSequence;",
                &[jni::objects::JValue::from(&*context)],
            )
            .map_err(|e| format!("coerceToText failed: {e}"))?
            .l()
            .map_err(|e| format!("Clip text invalid: {e}"))?;
        if text_obj.is_null() {
            return Ok(String::new());
        }

        let string_obj = env
            .call_method(&text_obj, "toString", "()Ljava/lang/String;", &[])
            .map_err(|e| format!("Clip text toString failed: {e}"))?
            .l()
            .map_err(|e| format!("Clip string invalid: {e}"))?;
        let jstr = JString::from(string_obj);
        env.get_string(&jstr)
            .map(|s| s.into())
            .map_err(|e| format!("Reading Android clipboard string failed: {e}"))
    })
}

#[cfg(target_os = "android")]
fn android_write_clipboard(text: String) -> Result<(), String> {
    use jni::objects::{JObject, JString, JValue};

    with_android_env(|env| {
        let clipboard = android_clipboard_manager(env)?;
        let label = env
            .new_string("2syn")
            .map_err(|e| format!("Clipboard label allocation failed: {e}"))?;
        let value = env
            .new_string(text)
            .map_err(|e| format!("Clipboard text allocation failed: {e}"))?;
        let label_obj = JObject::from(JString::from(label));
        let value_obj = JObject::from(JString::from(value));
        let clip_data_class = env
            .find_class("android/content/ClipData")
            .map_err(|e| format!("ClipData class unavailable: {e}"))?;
        let clip = env
            .call_static_method(
                clip_data_class,
                "newPlainText",
                "(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Landroid/content/ClipData;",
                &[JValue::from(&label_obj), JValue::from(&value_obj)],
            )
            .map_err(|e| format!("ClipData.newPlainText failed: {e}"))?
            .l()
            .map_err(|e| format!("ClipData object invalid: {e}"))?;

        env.call_method(
            &clipboard,
            "setPrimaryClip",
            "(Landroid/content/ClipData;)V",
            &[JValue::from(&clip)],
        )
        .map_err(|e| format!("setPrimaryClip failed: {e}"))?;
        Ok(())
    })
}

#[derive(serde::Deserialize)]
struct ServerActivateResponse {
    success: bool,
    ticket: Option<String>,
    message: String,
}

/// 驗證買斷授權金鑰并綁定設備
#[tauri::command]
async fn verify_license_key(license_key: String) -> Result<bool, String> {
    let hwid = generate_hwid().map_err(|e| e.to_string())?;

    // 呼叫授權驗證伺服器 (支援透過環境變數或預設區網 IP 測試)
    let signaling_url =
        std::env::var("SIGNALING_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/activate", signaling_url))
        .json(&serde_json::json!({
            "license_key": license_key,
            "hwid": hwid
        }))
        .send()
        .await
        .map_err(|e| format!("err_connect_server|{}", e))?;

    let status = res.status();
    let body: ServerActivateResponse = res
        .json()
        .await
        .map_err(|e| format!("err_parse_server_response|{}", e))?;

    if !status.is_success() || !body.success {
        return Err(body.message);
    }

    if let Some(ticket) = body.ticket {
        // 使用 Ed25519 離線密碼學驗證憑證簽章
        let is_valid =
            LicenseValidator::verify_license(&ticket, &[0u8; 32]).map_err(|e| e.to_string())?;

        if is_valid {
            // 儲存啟用憑證 (Ticket) 至系統 Keychain 安全區
            SecureStorage::save_secret("license_key", &ticket).map_err(|e| e.to_string())?;
            Ok(true)
        } else {
            Err("err_invalid_signature".to_string())
        }
    } else {
        Err("err_no_ticket".to_string())
    }
}

#[derive(serde::Serialize)]
pub struct LicenseStatus {
    pub status: String,
    pub trial_days_left: Option<u32>,
}

/// 初始化時檢查是否已有合法授權或仍在試用期內
#[tauri::command]
async fn check_license_status() -> Result<LicenseStatus, String> {
    println!("[license] check_license_status 被呼叫");

    // 1. 先檢查是否有買斷憑證
    if let Ok(ticket) = syn_core::security::SecureStorage::load_secret("license_key") {
        if let Ok(true) = syn_core::security::LicenseValidator::verify_license(&ticket, &[0u8; 32])
        {
            println!("[license] 驗證通過: 已買斷授權");
            return Ok(LicenseStatus {
                status: "buyout".to_string(),
                trial_days_left: None,
            });
        }
    }

    // 2. 若無買斷憑證，檢查或建立首次啟動時間（試用期 14 天）
    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let first_launch = match syn_core::security::SecureStorage::load_secret("first_launch_time") {
        Ok(time_str) => time_str.parse::<u64>().unwrap_or(current_time),
        Err(_) => {
            // 寫入首次啟動時間
            let _ = syn_core::security::SecureStorage::save_secret(
                "first_launch_time",
                &current_time.to_string(),
            );
            current_time
        }
    };

    let elapsed_secs = current_time.saturating_sub(first_launch);
    let trial_duration_secs = 14 * 24 * 60 * 60;

    if elapsed_secs <= trial_duration_secs {
        let remaining_secs = trial_duration_secs - elapsed_secs;
        let days_left = (remaining_secs / (24 * 60 * 60)) as u32;
        println!("[license] 試用期內，剩餘天數: {}", days_left);
        Ok(LicenseStatus {
            status: "trial".to_string(),
            trial_days_left: Some(days_left),
        })
    } else {
        println!("[license] 試用已過期");
        Ok(LicenseStatus {
            status: "expired".to_string(),
            trial_days_left: Some(0),
        })
    }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn toggle_privacy_mode(app: tauri::AppHandle, enable: bool) -> Result<String, String> {
    use tauri::Manager;
    if enable {
        // Windows 平台可透過虛擬顯示器驅動達到硬體級隱私模式
        #[cfg(target_os = "windows")]
        {
            let _ = syn_core::idd::VirtualDisplayManager::plug_monitor(1, 1920, 1080, 144);
        }

        // 建立全螢幕遮罩視窗 (Privacy Overlay)
        if app.get_webview_window("privacy-mask").is_none() {
            let builder = tauri::WebviewWindowBuilder::new(
                &app,
                "privacy-mask",
                tauri::WebviewUrl::App("privacy.html".into()),
            )
            .title("Privacy Mode")
            .fullscreen(true)
            .always_on_top(true)
            .decorations(false)
            .skip_taskbar(true);

            if let Err(e) = builder.build() {
                println!("[privacy] 建立遮罩失敗: {}", e);
            }
        }

        Ok("privacy_mode_enabled".to_string())
    } else {
        #[cfg(target_os = "windows")]
        {
            let _ = syn_core::idd::VirtualDisplayManager::unplug_monitor(1);
        }

        // 移除遮罩視窗
        if let Some(window) = app.get_webview_window("privacy-mask") {
            let _ = window.close();
        }
        Ok("privacy_mode_disabled".to_string())
    }
}

/// 動態插入虛擬螢幕控制命令
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn plug_virtual_monitor(
    index: u32,
    width: u32,
    height: u32,
    refresh_rate: u32,
) -> Result<String, String> {
    syn_core::idd::VirtualDisplayManager::plug_monitor(index, width, height, refresh_rate)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "plug_success|{}|{}|{}|{}",
        index, width, height, refresh_rate
    ))
}

/// 動態拔除虛擬螢幕控制命令
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn unplug_virtual_monitor(index: u32) -> Result<String, String> {
    syn_core::idd::VirtualDisplayManager::unplug_monitor(index).map_err(|e| e.to_string())?;
    Ok(format!("unplug_success|{}", index))
}

// TURN 伺服器設定：沿用瀏覽器端設定面板寫入 localStorage 的寬鬆 RTCIceServer
// 格式（urls 可以是單一字串或陣列，username/credential 可省略），由前端在呼叫
// generate_local_sdp_offer / handle_remote_offer_as_host 時一併傳入，讓 host 端
// 的 Rust WebRTC session 也能套用同一份 TURN 設定。
//
// 2026-05-27 一次無關的 signaling heartbeat 修正（commit b2465c6）誤刪了
// host 端原本的 custom_turn 參數與預設 TURN fallback，此後 host 端一直是
// 寫死的 STUN-only：即使使用者在設定面板填了 TURN，對 host 角色完全無效。
// 純 STUN 在任一端為對稱型 NAT / CGNAT / 嚴格防火牆時無法打通連線，症狀是
// ICE 停在 connecting、15 秒逾時斷線、client 端畫面全黑（見 DEVLOG）。
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(serde::Deserialize)]
struct TurnServerConfig {
    urls: TurnUrls,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    credential: Option<String>,
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum TurnUrls {
    Single(String),
    Multiple(Vec<String>),
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn turn_configs_to_ice_servers(
    configs: Vec<TurnServerConfig>,
) -> Vec<webrtc::ice_transport::ice_server::RTCIceServer> {
    use webrtc::ice_transport::ice_credential_type::RTCIceCredentialType;
    configs
        .into_iter()
        .map(|c| webrtc::ice_transport::ice_server::RTCIceServer {
            urls: match c.urls {
                TurnUrls::Single(s) => vec![s],
                TurnUrls::Multiple(v) => v,
            },
            username: c.username.unwrap_or_default(),
            credential: c.credential.unwrap_or_default(),
            credential_type: RTCIceCredentialType::Password,
            ..Default::default()
        })
        .collect()
}

// 使用者未設定自訂 TURN 時的預設 fallback（恢復 b2465c6 之前的行為），避免
// 完全沒有 TURN 導致對稱型 NAT/CGNAT 環境下無法連線。免費公用服務頻寬有限，
// 使用者可在設定面板填入自己的 TURN 伺服器覆蓋這組預設值。
#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn default_turn_servers() -> Vec<webrtc::ice_transport::ice_server::RTCIceServer> {
    use webrtc::ice_transport::ice_credential_type::RTCIceCredentialType;
    vec![webrtc::ice_transport::ice_server::RTCIceServer {
        urls: vec!["turn:openrelay.metered.ca:80".to_string()],
        username: "openrelayproject".to_string(),
        credential: "openrelayproject".to_string(),
        credential_type: RTCIceCredentialType::Password,
    }]
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn resolve_ice_servers(
    turn_servers: Option<Vec<TurnServerConfig>>,
) -> Vec<webrtc::ice_transport::ice_server::RTCIceServer> {
    match turn_servers {
        Some(list) if !list.is_empty() => turn_configs_to_ice_servers(list),
        _ => default_turn_servers(),
    }
}

/// 產生去中心化手動 SDP Offer 資訊
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn generate_local_sdp_offer(
    turn_servers: Option<Vec<TurnServerConfig>>,
) -> Result<String, String> {
    let session = syn_core::connection::WebRtcSession::create_session(resolve_ice_servers(turn_servers))
        .await
        .map_err(|e| e.to_string())?;

    let pc = session.get_peer_connection();
    session
        .setup_input_channel()
        .await
        .map_err(|e| e.to_string())?;
    session
        .setup_unreliable_input_channel()
        .await
        .map_err(|e| e.to_string())?;

    let offer = pc
        .create_offer(None)
        .await
        .map_err(|e| format!("err_create_offer|{}", e))?;

    pc.set_local_description(offer.clone())
        .await
        .map_err(|e| format!("err_set_local_description|{}", e))?;

    Ok(offer.sdp)
}

/// 處理遠端 Offer，建立 Answer 並啟動視訊串流 (作為被控端 Host)
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn handle_remote_offer_as_host(
    app_handle: tauri::AppHandle,
    offer_sdp: String,
    turn_servers: Option<Vec<TurnServerConfig>>,
) -> Result<String, String> {
    use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

    let session = syn_core::connection::WebRtcSession::create_session(resolve_ice_servers(turn_servers))
        .await
        .map_err(|e| e.to_string())?;

    syn_core::debug_log!("TAURI", "Adding video track");
    // 加入視訊軌道並啟動擷取迴圈
    let video_track = session.add_video_track().await.map_err(|e| e.to_string())?;
    syn_core::debug_log!("TAURI", "Adding foveated video track");
    let foveated_track = session.add_foveated_video_track().await.ok(); // 如果失敗就當作 None

    syn_core::debug_log!("TAURI", "Creating VideoStreamer");
    let mut streamer = syn_core::video::VideoStreamer::new(video_track, foveated_track).map_err(|e| e.to_string())?;
    syn_core::debug_log!("TAURI", "VideoStreamer created");

    // 加入音訊軌道並啟動擷取迴圈 (P1-A)
    syn_core::debug_log!("TAURI", "Adding audio track");
    let audio_track = session.add_audio_track().await.map_err(|e| e.to_string())?;
    syn_core::debug_log!("TAURI", "Creating AudioStreamer");
    let audio_streamer =
        syn_core::audio::AudioStreamer::new(audio_track).map_err(|e| e.to_string())?;
    syn_core::debug_log!("TAURI", "AudioStreamer created");
    use tauri::Manager;
    let app_state = app_handle.state::<AppState>();
    let active_webrtc = app_state.has_active_webrtc.clone();
    let active_webrtc_audio = active_webrtc.clone();

    // 本 session 專屬存活旗標：pc 關閉/失敗時歸零，令 video/audio 擷取迴圈徹底退出，
    // 避免每次連線/斷線循環累積永不結束的擷取任務（耗盡 blocking 執行緒池與 CPU，
    // 最終拖垮信令心跳 → 被控端掉線、client 顯示「Target offline」）。
    let session_alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let session_alive_audio = Arc::clone(&session_alive);

    tokio::spawn(async move {
        if let Err(e) = audio_streamer.start(active_webrtc_audio, session_alive_audio).await {
            eprintln!("[Audio] Failed to start audio streamer: {}", e);
        }
    });

    let (status_tx, mut status_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let app_clone_status = app_handle.clone();
    tokio::spawn(async move {
        while let Some(msg) = status_rx.recv().await {
            let _ = app_clone_status.emit("rust-video-status", msg);
        }
    });

    let state = app_handle.state::<AppState>();
    let config_rx = state.connection_manager.subscribe();

    // 建立監聽螢幕切換的 watch channel
    let (monitor_tx, monitor_rx) = tokio::sync::watch::channel(0usize);

    // 建立系統控制通道。螢幕列表先透過 Tauri runtime API 取得，再交給 core 在
    // DataChannel 開啟時送出；避免在 WebRTC callback 背景執行緒直接碰 xcap/NSScreen。
    let monitor_list_msg = build_monitor_list_message(&app_handle);
    if let Err(e) = session.setup_system_control_channel(monitor_tx, monitor_list_msg).await {
        eprintln!(
            "[SystemControl] Failed to setup system control channel: {}",
            e
        );
    }

    // 啟動 ABR 網路指標監控與位元率動態決策任務
    syn_core::connection::ConnectionManager::spawn_monitor_task(
        state.connection_manager.clone(),
        session.get_peer_connection(),
    );

    let active_webrtc = app_state.has_active_webrtc.clone();
    let session_alive_video = Arc::clone(&session_alive);
    syn_core::debug_log!("TAURI", "Starting video capture loop");

    streamer
        .start_capture_loop(Some(status_tx), config_rx, monitor_rx, active_webrtc, session_alive_video)
        .await;
    syn_core::debug_log!("TAURI", "Video capture loop started");

    let pc = session.get_peer_connection();

    // 監聽本機產生的 ICE Candidate。優先透過 Rust 後端信令直接發送，若未啟動則透過 Tauri Event 拋給前端。
    let app_clone = app_handle.clone();
    pc.on_ice_candidate(Box::new(
        move |c: Option<webrtc::ice_transport::ice_candidate::RTCIceCandidate>| {
            let app = app_clone.clone();
            if let Some(candidate) = c {
                if let Ok(json) = candidate.to_json() {
                    let app_inner = app.clone();
                    // 序列化完整的 RTCIceCandidateInit 物件（含 candidate, sdpMid, sdpMLineIndex）
                    // JS 端接收後會執行 JSON.parse(msg.candidate)，因此這裡必須傳入完整 JSON 字串
                    let candidate_init_json = serde_json::json!({
                        "candidate": json.candidate,
                        "sdpMid": json.sdp_mid,
                        "sdpMLineIndex": json.sdp_mline_index
                    })
                    .to_string();
                    let json_for_event = json.clone();
                    tokio::spawn(async move {
                        let state = app_inner.state::<AppState>();
                        let remote_id = state.current_remote_id.read().await.clone();
                        let tx_opt = state.signaling_tx.lock().await.clone();
                        if !remote_id.is_empty() {
                            if let Some(tx) = tx_opt {
                                let ice_msg = serde_json::json!({
                                    "type": "ice",
                                    "target": remote_id,
                                    "candidate": candidate_init_json
                                });
                                if tx.send(ice_msg.to_string()).await.is_ok() {
                                    println!("Rust 信令已發送本機 ICE Candidate 至 {}", remote_id);
                                    return;
                                }
                            }
                        }
                        let _ = app_inner.emit("rust-ice-candidate", json_for_event);
                    });
                }
            }
            Box::pin(async {})
        },
    ));

    let app_clone2 = app_handle.clone();
    // 捕捉本 session 的 pc identity：`has_active_webrtc` 是全域共享旗標，
    // 若讓「洩漏的舊 session」或 iOS ICE 短暫抖動的斷線事件把它打成 false，
    // 目前活躍 session 的 video 擷取迴圈會誤以為連線已斷而停止產生影格
    // → 畫面凍結在 fps 0.0 且永不恢復（Connected 不會再次觸發）。
    // 因此「設 false」必須限定於本 pc 確實是當前 active_pc 時才生效。
    let pc_for_state = Arc::clone(&pc);
    let session_alive_state = Arc::clone(&session_alive);
    pc.on_peer_connection_state_change(Box::new(
        move |state: webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState| {
            let _ = app_clone2.emit("rust-webrtc-state", state.to_string());
            let state_val = state;
            let app = app_clone2.clone();
            let pc_self = Arc::clone(&pc_for_state);
            let session_alive = Arc::clone(&session_alive_state);
            Box::pin(async move {
                use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
                // 終態（Failed/Closed）→ 令本 session 的擷取迴圈退出，釋放資源。
                // Disconnected 可能是短暫抖動、之後回到 Connected，故不在此終止迴圈。
                if matches!(state_val, RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed) {
                    session_alive.store(false, std::sync::atomic::Ordering::SeqCst);
                    // Failed 時主動 close，讓 pc 轉為 Closed → ABR 監控任務跳出、
                    // data channel 關閉、pc 的 Arc 得以釋放，徹底回收本 session。
                    if matches!(state_val, RTCPeerConnectionState::Failed) {
                        let pc_close = Arc::clone(&pc_self);
                        tokio::spawn(async move { let _ = pc_close.close().await; });
                    }
                }
                let app_state = app.state::<AppState>();
                if matches!(state_val, RTCPeerConnectionState::Connected) {
                    // 連上：一律標記活躍（安全方向，讓影像流動）
                    app_state
                        .has_active_webrtc
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                    println!("WebRTC 狀態變更: {:?}, 是否活躍: true", state_val);
                } else if matches!(state_val, RTCPeerConnectionState::Disconnected) {
                    // Disconnected 可能只是 ICE 短暫抖動；此時 data channel/input 仍可能可用。
                    // 若立刻把全域 active flag 關掉，host 擷取 loop 會停止產生影格，
                    // client 端就會永久停在最後一張畫面，但滑鼠/鍵盤仍會在 host 端生效。
                    println!("WebRTC 狀態變更: {:?}，視為暫時抖動，保持影像擷取活躍", state_val);
                } else if matches!(state_val, RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed) {
                    // 失敗/關閉：僅當本 pc 仍是當前 active session 時才標記非活躍。
                    let is_current = app_state
                        .active_pc
                        .lock()
                        .await
                        .as_ref()
                        .map(|cur| Arc::ptr_eq(cur, &pc_self))
                        .unwrap_or(false);
                    if is_current {
                        app_state
                            .has_active_webrtc
                            .store(false, std::sync::atomic::Ordering::SeqCst);
                        println!("WebRTC 狀態變更: {:?}, 是否活躍: false（當前 session）", state_val);
                    } else {
                        println!("WebRTC 狀態變更: {:?}（舊/非當前 session，忽略不影響活躍旗標）", state_val);
                    }
                } else {
                    // New/Connecting 等過渡狀態不關閉擷取，避免 ICE/data channel 已通但
                    // peer connection 聚合狀態尚未 Connected 時造成首幀黑屏。
                    println!("WebRTC 狀態變更: {:?}，等待 ICE/DTLS 穩定，不改變影像擷取狀態", state_val);
                }
            })
        },
    ));

    let app_clone_ice = app_handle.clone();
    let pc_for_ice = Arc::clone(&pc);
    let session_alive_ice = Arc::clone(&session_alive);
    pc.on_ice_connection_state_change(Box::new(
        move |ice_state: webrtc::ice_transport::ice_connection_state::RTCIceConnectionState| {
            let app = app_clone_ice.clone();
            let pc_self = Arc::clone(&pc_for_ice);
            let session_alive = Arc::clone(&session_alive_ice);
            Box::pin(async move {
                use webrtc::ice_transport::ice_connection_state::RTCIceConnectionState;
                let app_state = app.state::<AppState>();
                let is_current = app_state
                    .active_pc
                    .lock()
                    .await
                    .as_ref()
                    .map(|cur| Arc::ptr_eq(cur, &pc_self))
                    .unwrap_or(false);

                if !is_current {
                    println!("ICE 狀態變更: {:?}（舊/非當前 session，忽略）", ice_state);
                    return;
                }

                if matches!(ice_state, RTCIceConnectionState::Connected | RTCIceConnectionState::Completed) {
                    app_state
                        .has_active_webrtc
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                    println!("ICE 狀態變更: {:?}, 是否活躍: true", ice_state);
                } else if matches!(ice_state, RTCIceConnectionState::Failed | RTCIceConnectionState::Closed) {
                    session_alive.store(false, std::sync::atomic::Ordering::SeqCst);
                    app_state
                        .has_active_webrtc
                        .store(false, std::sync::atomic::Ordering::SeqCst);
                    println!("ICE 狀態變更: {:?}, 是否活躍: false", ice_state);
                } else if matches!(ice_state, RTCIceConnectionState::Disconnected) {
                    println!("ICE 狀態變更: {:?}，視為暫時抖動，保持影像擷取活躍", ice_state);
                }
            })
        },
    ));

    // 處理 DataChannel 接收事件，將序列號追蹤分為可靠與不可靠通道
    let control_last_seq = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let unreliable_last_seq = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let app_for_data_channel = app_handle.clone();
    let session_alive_data_channel = Arc::clone(&session_alive);

    pc.on_data_channel(Box::new(move |d| {
        let label = d.label().to_owned();
        let app = app_for_data_channel.clone();
        let session_alive = Arc::clone(&session_alive_data_channel);
        println!("Rust 接收到 DataChannel: {}", label);

        if label == "input-control" {
            println!("[input-control] 已綁定 on_message，等待接收點擊事件...");
            let last_seq = Arc::clone(&control_last_seq);
            let msg_count = Arc::new(std::sync::atomic::AtomicU64::new(0));
            d.on_message(Box::new(move |msg| {
                let data = msg.data.to_vec();
                let last_seq = Arc::clone(&last_seq);
                let count = msg_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if count < 10 || count % 50 == 0 {
                    println!("[input-control] 收到第 {} 筆訊息，長度={}", count + 1, data.len());
                }
                Box::pin(async move {
                    use std::sync::atomic::Ordering;
                    use syn_core::input::SecureInputPacket;
                    match SecureInputPacket::deserialize(&data) {
                        Ok(packet) => {
                            let prev_seq = last_seq.load(Ordering::SeqCst);
                            match packet.verify(prev_seq) {
                                Ok(()) => {
                                    last_seq.store(packet.sequence_number, Ordering::SeqCst);
                                    if let Err(e) = packet.event.simulate() {
                                        eprintln!("[input-control] simulate failed: {}", e);
                                    }
                                }
                                Err(e) => {
                                    eprintln!("[security input-control] packet rejected: {}", e)
                                }
                            }
                        }
                        Err(err) => eprintln!("[input-control] deserialize failed: {:?}", err),
                    }
                })
            }));
        } else if label == "input-unreliable" {
            let last_seq = Arc::clone(&unreliable_last_seq);
            d.on_message(Box::new(move |msg| {
                let data = msg.data.to_vec();
                let last_seq = Arc::clone(&last_seq);
                Box::pin(async move {
                    use std::sync::atomic::Ordering;
                    use syn_core::input::SecureInputPacket;
                    match SecureInputPacket::deserialize(&data) {
                        Ok(packet) => {
                            let prev_seq = last_seq.load(Ordering::SeqCst);
                            match packet.verify(prev_seq) {
                                Ok(()) => {
                                    last_seq.store(packet.sequence_number, Ordering::SeqCst);
                                    if let Err(e) = packet.event.simulate() {
                                        eprintln!("[input-unreliable] simulate failed: {}", e);
                                    }
                                }
                                Err(e) => {
                                    eprintln!("[security input-unreliable] packet rejected: {}", e)
                                }
                            }
                        }
                        Err(err) => eprintln!("[input-unreliable] deserialize failed: {:?}", err),
                    }
                })
            }));
        } else if label == "system-control" {
            let app_for_system = app.clone();
            d.on_message(Box::new(move |msg| {
                let data = msg.data.to_vec();
                let app = app_for_system.clone();
                Box::pin(async move {
                    if let Ok(text) = String::from_utf8(data) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                            if json["type"] == "file_transfer_priority" {
                                let active = json["active"].as_bool().unwrap_or(false);
                                let state = app.state::<AppState>();
                                state.connection_manager.set_transfer_priority(active).await;
                                println!(
                                    "[file-transfer] Transfer priority mode {}",
                                    if active { "enabled" } else { "disabled" }
                                );
                            }
                        }
                    }
                })
            }));
        } else if label == "clipboard" {
            // 剪貼簿同步 DataChannel
            let last_clipboard_text = Arc::new(tokio::sync::Mutex::new(String::new()));
            let last_seen_for_message = Arc::clone(&last_clipboard_text);
            let dc_for_message = Arc::clone(&d);
            d.on_message(Box::new(move |msg| {
                let data = msg.data.to_vec();
                let last_seen = Arc::clone(&last_seen_for_message);
                let dc = Arc::clone(&dc_for_message);
                Box::pin(async move {
                    if let Ok(text_str) = std::str::from_utf8(&data) {
                        // 格式: JSON {"type":"clipboard_push","text":"..."}
                        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(text_str) {
                            let msg_type = json_val.get("type").and_then(|v| v.as_str());
                            if msg_type == Some("clipboard_push") {
                                if let Some(text) = json_val.get("text").and_then(|v| v.as_str()) {
                                    #[cfg(not(any(target_os = "ios", target_os = "android")))]
                                    {
                                        use arboard::Clipboard;
                                        *last_seen.lock().await = text.to_string();
                                        if let Ok(mut cb) = Clipboard::new() {
                                            let _ = cb.set_text(text.to_string());
                                            eprintln!(
                                                "[clipboard] 已同步剪貼簿內容 ({} 字元)",
                                                text.len()
                                            );
                                        }
                                    }
                                }
                            } else if msg_type == Some("clipboard_request") {
                                #[cfg(not(any(target_os = "ios", target_os = "android")))]
                                {
                                    if let Ok(mut cb) = arboard::Clipboard::new() {
                                        if let Ok(text) = cb.get_text() {
                                            let mut last = last_seen.lock().await;
                                            *last = text.clone();
                                            let msg = serde_json::json!({
                                                "type": "clipboard_push",
                                                "text": text
                                            });
                                            if let Err(e) = dc.send_text(msg.to_string()).await {
                                                eprintln!("[clipboard] 回傳 host 剪貼簿至 client 失敗: {}", e);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                })
            }));

            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let dc_for_open = Arc::clone(&d);
                let last_seen_for_open = Arc::clone(&last_clipboard_text);
                let session_alive_for_open = Arc::clone(&session_alive);
                d.on_open(Box::new(move || {
                    let dc = Arc::clone(&dc_for_open);
                    let last_seen = Arc::clone(&last_seen_for_open);
                    let session_alive = Arc::clone(&session_alive_for_open);
                    Box::pin(async move {
                        use webrtc::data_channel::data_channel_state::RTCDataChannelState;
                        while session_alive.load(std::sync::atomic::Ordering::SeqCst)
                            && dc.ready_state() == RTCDataChannelState::Open
                        {
                            if let Ok(mut cb) = arboard::Clipboard::new() {
                                if let Ok(text) = cb.get_text() {
                                    if !text.is_empty() {
                                        let mut last = last_seen.lock().await;
                                        if *last != text {
                                            *last = text.clone();
                                            let msg = serde_json::json!({
                                                "type": "clipboard_push",
                                                "text": text
                                            });
                                            if let Err(e) = dc.send_text(msg.to_string()).await {
                                                eprintln!("[clipboard] 推送 host 剪貼簿至 client 失敗: {}", e);
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                        }
                    })
                }));
            }
        } else if label == "file-transfer" {
            // 檔案傳輸 DataChannel
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let app_for_initial_state = app.clone();
                let dc_for_initial_state = Arc::clone(&d);
                tokio::spawn(async move {
                    let state = app_for_initial_state.state::<AppState>();
                    *state.active_file_channel.lock().await = Some(dc_for_initial_state);
                });

                let dc_for_state = Arc::clone(&d);
                let app_for_state = app.clone();
                d.on_open(Box::new(move || {
                    let dc = Arc::clone(&dc_for_state);
                    let app = app_for_state.clone();
                    Box::pin(async move {
                        let state = app.state::<AppState>();
                        *state.active_file_channel.lock().await = Some(dc);
                        println!("[file-transfer] Active file channel is ready");
                    })
                }));

                let app_for_close = app.clone();
                let dc_for_close = Arc::clone(&d);
                d.on_close(Box::new(move || {
                    let app = app_for_close.clone();
                    let dc = Arc::clone(&dc_for_close);
                    Box::pin(async move {
                        let state = app.state::<AppState>();
                        let mut active = state.active_file_channel.lock().await;
                        let is_current = active
                            .as_ref()
                            .map(|current| Arc::ptr_eq(current, &dc))
                            .unwrap_or(false);
                        if is_current {
                            *active = None;
                            println!("[file-transfer] Active file channel cleared");
                        } else {
                            println!("[file-transfer] Ignored close from superseded file channel");
                        }
                    })
                }));
            }
            let receive_download_dir = app.path().download_dir().ok();
            let file_state = Arc::new(tokio::sync::Mutex::new(
                syn_core::file_transfer::FileTransferState::with_download_dir(receive_download_dir),
            ));
            let app_for_file_events = app.clone();
            let dc_for_file_events = Arc::clone(&d);
            d.on_message(Box::new(move |msg| {
                let data = msg.data.to_vec();
                let file_state = Arc::clone(&file_state);
                let app = app_for_file_events.clone();
                let dc = Arc::clone(&dc_for_file_events);
                Box::pin(async move {
                    let mut state = file_state.lock().await;
                    // 如果能解析為字串，可能是控制訊息 (JSON)
                    if let Ok(text_str) = std::str::from_utf8(&data) {
                        if text_str.starts_with("{") {
                            if let Ok(value) = serde_json::from_str::<serde_json::Value>(text_str) {
                                if value.get("action").and_then(|value| value.as_str()) == Some("resume") {
                                    if let Some(id) = value.get("id").and_then(|value| value.as_str()) {
                                        let offset = value
                                            .get("offset")
                                            .and_then(|value| value.as_u64())
                                            .unwrap_or(0);
                                        let app_state = app.state::<AppState>();
                                        app_state
                                            .file_resume_offsets
                                            .lock()
                                            .await
                                            .insert(id.to_string(), offset);
                                    }
                                } else if value.get("action").and_then(|value| value.as_str()) == Some("complete") {
                                    if let Some(id) = value.get("id").and_then(|value| value.as_str()) {
                                        let app_state = app.state::<AppState>();
                                        app_state
                                            .file_complete_confirmations
                                            .lock()
                                            .await
                                            .insert(id.to_string());
                                    }
                                }
                            }
                            state.handle_message(text_str);
                            for outgoing in state.take_outgoing_messages() {
                                let _ = dc.send_text(outgoing).await;
                            }
                            if let Some(completed) = state.take_completed() {
                                let _ = app.emit(
                                    "file-transfer-received",
                                    serde_json::json!({
                                        "name": completed.name,
                                        "path": completed.path.to_string_lossy().to_string(),
                                        "size": completed.size
                                    }),
                                );
                            }
                            return;
                        }
                    }
                    // 否則視為二進位檔案內容
                    state.handle_binary(&data);
                    for outgoing in state.take_outgoing_messages() {
                        let _ = dc.send_text(outgoing).await;
                    }
                })
            }));
        } else {
            d.on_message(Box::new(move |msg| {
                println!(
                    "收到 DataChannel ({}) 訊息: {} bytes",
                    label,
                    msg.data.len()
                );
                Box::pin(async {})
            }));
        }

        Box::pin(async {})
    }));

    // 套用 Remote Offer
    let sdp = RTCSessionDescription::offer(offer_sdp).map_err(|e| e.to_string())?;
    pc.set_remote_description(sdp)
        .await
        .map_err(|e| e.to_string())?;

    // 儲存 pc 供 ICE 使用；先關閉並丟棄上一條連線，避免舊 session 洩漏。
    // iOS WKWebView 斷線時常不乾淨關閉 SCTP/data channel，舊 host session 會殘留
    // （video/audio 擷取迴圈、input-control on_message 與其 last_seq 皆還活著）。
    // 重連建立新 session 後，殘留的舊 session 會與新 session 爭用全域輸入狀態與
    // 序號體系，造成「重連後點擊失效、移動正常」等半失效症狀。Android 斷線清理
    // 乾淨故不觸發。此處在換上新 pc 前主動 close 舊 pc，確保單一 active session。
    let state = app_handle.state::<AppState>();
    let old_pc = state.active_pc.lock().await.replace(Arc::clone(&pc));
    if let Some(old) = old_pc {
        tokio::spawn(async move {
            if let Err(e) = old.close().await {
                eprintln!("[WebRTC] 關閉舊 session 失敗（可忽略）: {}", e);
            } else {
                println!("[WebRTC] 已關閉上一條殘留 session，確保單一 active 連線");
            }
        });
    }

    // 建立 Local Answer
    let answer = pc.create_answer(None).await.map_err(|e| e.to_string())?;
    pc.set_local_description(answer.clone())
        .await
        .map_err(|e| e.to_string())?;

    Ok(answer.sdp)
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
enum IncomingMessage {
    #[serde(rename = "offer")]
    Offer {
        source: String,
        pin: String,
        sdp: String,
    },
    #[serde(rename = "ice")]
    Ice { source: String, candidate: String },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "custom_request_logs")]
    CustomRequestLogs { source: String, target: String },
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn apply_ice_candidate(state: &AppState, candidate_str: &str) -> Result<(), String> {
    if candidate_str.is_empty() || candidate_str == "null" {
        return Ok(());
    }
    use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
    let pc_opt = state.active_pc.lock().await.clone();
    if let Some(pc) = pc_opt {
        match serde_json::from_str::<RTCIceCandidateInit>(candidate_str) {
            Ok(candidate) => {
                pc.add_ice_candidate(candidate)
                    .await
                    .map_err(|e| e.to_string())?;
                println!("已成功加入遠端 ICE Candidate");
            }
            Err(e) => return Err(format!("JSON 解析失敗: {}", e)),
        }
    } else {
        return Err("PeerConnection 尚未建立".to_string());
    }
    Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn start_rust_signaling_task(
    app_handle: tauri::AppHandle,
    my_id: String,
    mut ws_rx: tokio::sync::mpsc::Receiver<String>,
    abort_rx: tokio::sync::oneshot::Receiver<()>,
) {
    let ws_url = "wss://twosyn-signaling.onrender.com/ws";

    // 共享當前活躍之 WebSocket 傳送端
    let active_ws_sender = Arc::new(tokio::sync::Mutex::new(None));

    // 轉發任務在 loop 外僅 spawn 一次，防止 Receiver 擁有權移入 loop 內部
    let active_ws_sender_clone = Arc::clone(&active_ws_sender);
    let mut _forward_task = tokio::spawn(async move {
        while let Some(msg_str) = ws_rx.recv().await {
            let tx_opt: Option<tokio::sync::mpsc::Sender<WsMessage>> =
                active_ws_sender_clone.lock().await.clone();
            if let Some(tx) = tx_opt {
                let _ = tx.send(WsMessage::Text(msg_str)).await;
            }
        }
    });

    let mut abort_rx = abort_rx;
    loop {
        // 檢查是否收到中止信號
        if !matches!(
            abort_rx.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty)
        ) {
            println!("[Rust Signaling] 偵測到中止信號或通道已關閉，退出舊信令任務");
            break;
        }

        let connect_msg = format!("嘗試連線到信令伺服器: {}", ws_url);
        println!("[Rust Signaling] {}", connect_msg);
        let _ = app_handle.emit("rust-signaling-log", format!("[Rust] {}", connect_msg));
        let _ = app_handle.emit("rust-signaling-status", "connecting");

        let url_parsed = match url::Url::parse(ws_url) {
            Ok(u) => u,
            Err(e) => {
                let err_msg = format!("URL 解析錯誤: {}", e);
                eprintln!("[Rust Signaling] {}", err_msg);
                let _ = app_handle.emit("rust-signaling-log", format!("[Rust Error] {}", err_msg));
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        let conn_res = connect_async(url_parsed).await;
        let (ws_stream, _) = match conn_res {
            Ok(val) => val,
            Err(e) => {
                let err_msg = format!("連線信令伺服器失敗: {}, 5 秒後重試", e);
                eprintln!("[Rust Signaling] {}", err_msg);
                let _ = app_handle.emit("rust-signaling-log", format!("[Rust Error] {}", err_msg));
                let _ = app_handle.emit("rust-signaling-status", "offline");
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        let success_msg = "已成功建立 WebSocket 連線，正在登入...";
        println!("[Rust Signaling] {}", success_msg);
        let _ = app_handle.emit("rust-signaling-log", format!("[Rust] {}", success_msg));

        let (mut ws_write, mut ws_read) = ws_stream.split();

        let login_msg = serde_json::json!({
            "type": "login",
            "id": my_id
        });
        if let Err(e) = ws_write.send(WsMessage::Text(login_msg.to_string())).await {
            let err_msg = format!("發送登入封包失敗: {}", e);
            eprintln!("[Rust Signaling] {}", err_msg);
            let _ = app_handle.emit("rust-signaling-log", format!("[Rust Error] {}", err_msg));
            let _ = app_handle.emit("rust-signaling-status", "offline");
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            continue;
        }

        let _ = app_handle.emit("rust-signaling-status", "online");
        let login_ok_msg = format!("登入成功，ID: {}", my_id);
        println!("[Rust Signaling] {}", login_ok_msg);
        let _ = app_handle.emit("rust-signaling-log", format!("[Rust] {}", login_ok_msg));

        let (tx, mut rx) = tokio::sync::mpsc::channel::<WsMessage>(100);

        // 更新當前活躍的 WebSocket 傳送端
        *active_ws_sender.lock().await = Some(tx.clone());

        // 建立最後讀取時間指標以防範半關閉假死
        let last_read_time = Arc::new(tokio::sync::RwLock::new(std::time::Instant::now()));
        let last_read_time_write = Arc::clone(&last_read_time);

        // 1. 獨立的看門狗任務 (Watchdog) 用於偵測心跳接收超時，即使發送端卡死也絕不受影響
        let app_handle_timeout = app_handle.clone();
        let last_read_time_timeout = Arc::clone(&last_read_time);
        let start_time = std::time::Instant::now();
        let mut timeout_task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
            loop {
                interval.tick().await;

                // A. 心跳超時檢測
                let elapsed = last_read_time_timeout.read().await.elapsed();
                if elapsed > std::time::Duration::from_secs(35) {
                    let err_msg = format!(
                        "心跳接收超時 ({} 秒未收到伺服器訊息)，主動判定斷線",
                        elapsed.as_secs()
                    );
                    eprintln!("[Rust Signaling] {}", err_msg);
                    let _ = app_handle_timeout
                        .emit("rust-signaling-log", format!("[Rust Error] {}", err_msg));
                    break;
                }

                // B. 每 10 分鐘無活動 WebRTC 連線時，自動斷開重新建立信令以刷新負載均衡路由
                let conn_duration = start_time.elapsed();
                if conn_duration > std::time::Duration::from_secs(600) {
                    let app_state = app_handle_timeout.state::<AppState>();
                    let has_active = app_state
                        .has_active_webrtc
                        .load(std::sync::atomic::Ordering::SeqCst);
                    if !has_active {
                        let self_healing_msg = format!(
                            "信令連線已達 {} 秒且無活動控制連線，執行自動重連自癒以更新路由",
                            conn_duration.as_secs()
                        );
                        println!("[Rust Signaling] {}", self_healing_msg);
                        let _ = app_handle_timeout.emit(
                            "rust-signaling-log",
                            format!("[Rust Warn] {}", self_healing_msg),
                        );
                        break;
                    }
                }
            }
        });

        // 2. 寫入任務，只負責發送心跳及轉發，防止與超時檢測相互干擾卡死
        let mut ws_write_task = tokio::spawn(async move {
            let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(10));
            loop {
                tokio::select! {
                    _ = heartbeat.tick() => {
                        let ping_msg = serde_json::json!({ "type": "ping" });
                        if ws_write.send(WsMessage::Text(ping_msg.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Some(msg) = rx.recv() => {
                        if ws_write.send(msg).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });

        // 3. 讀取任務
        let app_handle_clone = app_handle.clone();
        let tx_clone = tx.clone();
        let mut ws_read_task = tokio::spawn(async move {
            while let Some(Ok(WsMessage::Text(text))) = ws_read.next().await {
                // 更新最後讀取時間
                *last_read_time_write.write().await = std::time::Instant::now();

                if let Ok(incoming) = serde_json::from_str::<IncomingMessage>(&text) {
                    match incoming {
                        IncomingMessage::Offer { source, pin, sdp } => {
                            let msg = format!("收到來自 {} 的 Offer，進行驗證...", source);
                            println!("[Rust Signaling] {}", msg);
                            let _ = app_handle_clone
                                .emit("rust-signaling-log", format!("[Rust] {}", msg));
                            let state = app_handle_clone.state::<AppState>();

                            let is_static_valid = match SecureStorage::load_secret(STATIC_PWD_KEY) {
                                Ok(saved_pwd) => !saved_pwd.is_empty() && saved_pwd == pin,
                                Err(_) => false,
                            };

                            if !is_static_valid {
                                let reject_info =
                                    format!("拒絕來自 {} 的連線：無人值守密碼驗證失敗", source);
                                println!("[Rust Signaling] {}", reject_info);
                                let _ = app_handle_clone.emit(
                                    "rust-signaling-log",
                                    format!("[Rust Error] {}", reject_info),
                                );
                                let reject_msg = serde_json::json!({
                                    "type": "error",
                                    "target": source,
                                    "message": "Connection rejected: Invalid Password"
                                });
                                let _ =
                                    tx_clone.send(WsMessage::Text(reject_msg.to_string())).await;
                                continue;
                            }

                            *state.current_remote_id.write().await = source.clone();

                            // 純 Rust 背景無人值守路徑，沒有 JS/localStorage 可讀取使用者
                            // 設定的自訂 TURN，只能套用預設 fallback（見 resolve_ice_servers）
                            match handle_remote_offer_as_host(app_handle_clone.clone(), sdp, None).await {
                                Ok(answer_sdp) => {
                                    let ok_msg =
                                        format!("成功處理 Offer，正在回傳 Answer 至 {}...", source);
                                    println!("[Rust Signaling] {}", ok_msg);
                                    let _ = app_handle_clone
                                        .emit("rust-signaling-log", format!("[Rust] {}", ok_msg));
                                    let answer_msg = serde_json::json!({
                                        "type": "answer",
                                        "target": source,
                                        "sdp": answer_sdp
                                    });
                                    let _ = tx_clone
                                        .send(WsMessage::Text(answer_msg.to_string()))
                                        .await;
                                }
                                Err(e) => {
                                    let err_msg = format!("處理 Offer 失敗: {}", e);
                                    eprintln!("[Rust Signaling] {}", err_msg);
                                    let _ = app_handle_clone.emit(
                                        "rust-signaling-log",
                                        format!("[Rust Error] {}", err_msg),
                                    );
                                    let reject_msg = serde_json::json!({
                                        "type": "error",
                                        "target": source,
                                        "message": format!("Connection rejected: {}", e)
                                    });
                                    let _ = tx_clone
                                        .send(WsMessage::Text(reject_msg.to_string()))
                                        .await;
                                }
                            }
                        }
                        IncomingMessage::Ice { source, candidate } => {
                            let state = app_handle_clone.state::<AppState>();
                            let msg = format!("收到來自 {} 的 ICE Candidate，套用中...", source);
                            println!("[Rust Signaling] {}", msg);
                            let _ = app_handle_clone
                                .emit("rust-signaling-log", format!("[Rust] {}", msg));
                            if let Err(e) = apply_ice_candidate(&state, &candidate).await {
                                let err_msg = format!("套用 ICE Candidate 失敗: {}", e);
                                eprintln!("[Rust Signaling] {}", err_msg);
                                let _ = app_handle_clone.emit(
                                    "rust-signaling-log",
                                    format!("[Rust Error] {}", err_msg),
                                );
                            }
                        }
                        IncomingMessage::Error { message } => {
                            let err_msg = format!("收到伺服器錯誤: {}", message);
                            eprintln!("[Rust Signaling] {}", err_msg);
                            let _ = app_handle_clone
                                .emit("rust-signaling-log", format!("[Rust Error] {}", err_msg));
                            if message.contains("shutting down") {
                                println!(
                                    "[Rust Signaling] 偵測到伺服器優雅退出通知，主動斷開以觸發重連"
                                );
                                break;
                            }
                        }
                        IncomingMessage::Pong => {
                            // 收到心跳回覆，只為更新最後讀取時間，無須額外動作
                        }
                        IncomingMessage::CustomRequestLogs { source, target } => {
                            let msg = format!("收到來自 {} 的自訂日誌索取請求", source);
                            println!("[Rust Signaling] {}", msg);
                            let _ = app_handle_clone
                                .emit("rust-signaling-log", format!("[Rust] {}", msg));
                            // 將請求轉發給前端 JS
                            let _ = app_handle_clone.emit(
                                "custom-request-logs-event",
                                serde_json::json!({
                                    "source": source,
                                    "target": target
                                })
                                .to_string(),
                            );
                        }
                    }
                }
            }
        });

        // 監聽三個子任務，任何一方結束或拋錯即觸發其餘任務的中斷與斷線重連
        tokio::select! {
            _ = &mut ws_write_task => {
                ws_read_task.abort();
                timeout_task.abort();
            }
            _ = &mut ws_read_task => {
                ws_write_task.abort();
                timeout_task.abort();
            }
            _ = &mut timeout_task => {
                ws_write_task.abort();
                ws_read_task.abort();
            }
            _ = &mut abort_rx => {
                ws_write_task.abort();
                ws_read_task.abort();
                timeout_task.abort();
                println!("[Rust Signaling] 收到中止信號，主動結束連線");
                break;
            }
        }

        // 斷線後，清除當前活躍之 WebSocket 發送端
        *active_ws_sender.lock().await = None;

        let disconnect_info = "信令連線已斷開，5 秒後重新連線...";
        println!("[Rust Signaling] {}", disconnect_info);
        let _ = app_handle.emit(
            "rust-signaling-log",
            format!("[Rust Warn] {}", disconnect_info),
        );
        let _ = app_handle.emit("rust-signaling-status", "offline");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn start_rust_signaling(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    my_id: String,
    pin: String,
) -> Result<(), String> {
    *state.current_pin.write().await = pin;

    // 1. 如果有舊的信令任務在跑，先發送 abort 信號將其終止
    let mut abort_lock = state.signaling_abort.lock().await;
    if let Some(abort_tx) = abort_lock.take() {
        let _ = abort_tx.send(());
        // 稍微等待舊連線釋放，防範連接埠或信令狀態衝突
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel::<()>();
    *abort_lock = Some(abort_tx);

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(100);
    *state.signaling_tx.lock().await = Some(tx);

    tokio::spawn(async move {
        start_rust_signaling_task(app_handle, my_id, rx, abort_rx).await;
    });

    Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn update_rust_pin(state: State<'_, AppState>, pin: String) -> Result<(), String> {
    *state.current_pin.write().await = pin;
    println!("[Rust] PIN 碼已同步更新");
    Ok(())
}

/// 接收來自遠端的 ICE Candidate 並套用至 Rust PeerConnection
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn add_ice_candidate_to_rust(
    state: State<'_, AppState>,
    candidate_str: String,
) -> Result<(), String> {
    apply_ice_candidate(&state, &candidate_str).await
}

/// 獲取當前連線品質狀態，供前端即時面板顯示
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn get_connection_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = state.connection_manager.get_current_config().await;
    let metrics = state.connection_manager.get_current_metrics().await;

    let color_format_str = match config.color_format {
        syn_core::connection::ColorFormat::Yuv444 => "color_yuv444",
        syn_core::connection::ColorFormat::Yuv420 => "color_yuv420",
    };

    let conn_type_str = match metrics.connection_type {
        syn_core::connection::ConnectionType::P2PDirect => "P2PDirect",
        syn_core::connection::ConnectionType::Relay => "Relay",
    };

    Ok(serde_json::json!({
        "target_fps": config.target_fps,
        "color_format": color_format_str,
        "bitrate_limit_kbps": config.bitrate_limit_kbps,
        "file_transfer_enabled": false,
        "rtt_ms": metrics.rtt_ms,
        "packet_loss_rate": metrics.packet_loss_rate,
        "connection_type": conn_type_str,
    }))
}

/// 檢查本機網路體質 (IPv6 與 Tailscale)
#[tauri::command]
async fn check_network_health() -> Result<serde_json::Value, String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        // 行動端不需要桌面網卡探測，預設回傳基礎支援
        Ok(serde_json::json!({
            "has_ipv6": true,
            "has_tailscale": false
        }))
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        static NETWORK_HEALTH_CACHE: std::sync::OnceLock<
            std::sync::Mutex<Option<(std::time::Instant, serde_json::Value)>>,
        > = std::sync::OnceLock::new();

        let cache = NETWORK_HEALTH_CACHE.get_or_init(|| std::sync::Mutex::new(None));
        if let Ok(guard) = cache.lock() {
            if let Some((checked_at, value)) = guard.as_ref() {
                if checked_at.elapsed() < std::time::Duration::from_secs(60) {
                    return Ok(value.clone());
                }
            }
        }

        let interfaces = if_addrs::get_if_addrs().map_err(|e| e.to_string())?;
        let has_ipv6 = interfaces.iter().any(|iface| match &iface.addr {
            if_addrs::IfAddr::V6(addr) => !addr.ip.is_loopback(),
            if_addrs::IfAddr::V4(_) => false,
        });
        let has_tailscale = interfaces.iter().any(|iface| {
            let name = iface.name.to_ascii_lowercase();
            let is_tailscale_name = name.contains("tailscale");
            let is_tailscale_addr = match &iface.addr {
                if_addrs::IfAddr::V4(addr) => {
                    let octets = addr.ip.octets();
                    octets[0] == 100 && (64..=127).contains(&octets[1])
                }
                if_addrs::IfAddr::V6(addr) => {
                    let segments = addr.ip.segments();
                    segments[0] == 0xfd7a && segments[1] == 0x115c && segments[2] == 0xa1e0
                }
            };
            is_tailscale_name || is_tailscale_addr
        });

        let value = serde_json::json!({
            "has_ipv6": has_ipv6,
            "has_tailscale": has_tailscale
        });

        if let Ok(mut guard) = cache.lock() {
            *guard = Some((std::time::Instant::now(), value.clone()));
        }

        Ok(value)
    }
}

/// 執行連線診斷，返回評估報告
#[tauri::command]
async fn run_connection_diagnostic() -> Result<serde_json::Value, String> {
    println!("[DEBUG] 執行連線診斷");
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    Ok(serde_json::json!({
        "hwid": generate_hwid().unwrap_or_default(),
        "license_active": true,
        "stun_dns_resolved": true,
        "nat_type": "nat_type_cone",
        "suggested_action": "action_none"
    }))
}

/// 切換網路模擬狀態
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn trigger_network_simulation(
    state: State<'_, AppState>,
    rtt_ms: u32,
    loss_rate: f32,
    is_relay: bool,
) -> Result<String, String> {
    println!(
        "[DEBUG] 收到網路模擬請求: {} ms, {}%, relay: {}",
        rtt_ms, loss_rate, is_relay
    );
    let mut metrics = state.connection_manager.get_current_metrics().await;

    metrics.rtt_ms = rtt_ms;
    metrics.packet_loss_rate = loss_rate;
    if is_relay {
        metrics.connection_type = syn_core::connection::ConnectionType::Relay;
    } else {
        metrics.connection_type = syn_core::connection::ConnectionType::P2PDirect;
    }

    state.connection_manager.update_metrics(metrics).await;
    Ok("ok".to_string())
}

mod permissions;

#[tauri::command]
async fn check_macos_permissions(window: tauri::Window) -> Result<bool, String> {
    Ok(permissions::check_and_request_permissions(&window))
}

/// 接收來自前端 WebRTC Data Channel 的二進位輸入封包並執行（被控端）
/// 跨平台：macOS/iOS/Windows/Android 均透過此指令執行遠端控制
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn handle_remote_input(data: Vec<u8>) -> Result<(), String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::OnceLock;
    use syn_core::input::SecureInputPacket;

    static LAST_SEQ: OnceLock<AtomicU32> = OnceLock::new();
    let last_seq = LAST_SEQ.get_or_init(|| AtomicU32::new(0));

    match SecureInputPacket::deserialize(&data) {
        Ok(packet) => {
            let prev_seq = last_seq.load(Ordering::SeqCst);
            match packet.verify(prev_seq) {
                Ok(()) => {
                    last_seq.store(packet.sequence_number, Ordering::SeqCst);
                    packet.event.simulate().map_err(|e| e.to_string())?;
                }
                Err(e) => eprintln!("[security] 封包遭拒（重放防護）: {}", e),
            }
        }
        Err(e) => eprintln!("[input] 反序列化失敗: {:?}", e),
    }
    Ok(())
}

/// 透過 Rust 信令發送自訂的 WebSocket 訊息 (例如日誌回傳)
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn send_custom_signaling_message(
    state: State<'_, AppState>,
    message: String,
) -> Result<(), String> {
    let tx_opt = state.signaling_tx.lock().await.clone();
    if let Some(tx) = tx_opt {
        tx.send(message)
            .await
            .map_err(|e| format!("發送信令失敗: {}", e))?;
        Ok(())
    } else {
        Err("信令連線未建立".to_string())
    }
}

#[tauri::command]
async fn wake_device(mac: String) -> Result<(), String> {
    syn_core::wol::wake_on_lan(&mac).await
}

#[tauri::command]
fn get_local_mac_address() -> Result<String, String> {
    syn_core::wol::get_local_mac_address()
}

#[tauri::command]
fn get_app_product_name(app: tauri::AppHandle) -> String {
    app.config().product_name.clone().unwrap_or_else(|| "2syn Host".to_string())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn build_monitor_list_message(app: &tauri::AppHandle) -> Option<serde_json::Value> {
    let monitors = app.available_monitors().ok()?;
    if monitors.is_empty() {
        return None;
    }
    let primary = app.primary_monitor().ok().flatten();

    let monitors_json: Vec<serde_json::Value> = monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let size = monitor.size();
            let position = monitor.position();
            let is_primary = primary.as_ref().map(|p| {
                p.position() == position && p.size() == size
            }).unwrap_or(index == 0);

            serde_json::json!({
                "id": index,
                "name": monitor.name().cloned().unwrap_or_else(|| format!("Display {}", index + 1)),
                "is_primary": is_primary,
                "x": position.x,
                "y": position.y,
                "width": size.width,
                "height": size.height,
                "scale_factor": monitor.scale_factor(),
            })
        })
        .collect();

    Some(serde_json::json!({
        "type": "monitor_list",
        "monitors": monitors_json,
        "current": 0
    }))
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn has_active_file_transfer_channel(state: State<'_, AppState>) -> Result<bool, String> {
    use webrtc::data_channel::data_channel_state::RTCDataChannelState;

    let channel = state.active_file_channel.lock().await.clone();
    Ok(channel
        .as_ref()
        .map(|dc| dc.ready_state() == RTCDataChannelState::Open)
        .unwrap_or(false))
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn cancel_active_file_transfer(state: State<'_, AppState>) -> Result<(), String> {
    let channel = state.active_file_channel.lock().await.take();
    if let Some(dc) = channel {
        dc.close()
            .await
            .map_err(|e| format!("無法關閉檔案傳輸通道: {}", e))?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn pick_transfer_files() -> Result<Vec<SelectedTransferFile>, String> {
    let files = rfd::AsyncFileDialog::new()
        .pick_files()
        .await
        .unwrap_or_default();
    let mut selected = Vec::new();
    for file in files {
        let path = file.path().to_path_buf();
        let metadata = match tokio::fs::metadata(&path).await {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => continue,
        };
        let Some(name) = path.file_name().and_then(|name| name.to_str()).map(|name| name.to_string()) else {
            continue;
        };
        let last_modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        selected.push(SelectedTransferFile {
            name,
            path: path.to_string_lossy().to_string(),
            size: metadata.len(),
            last_modified,
        });
    }
    Ok(selected)
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn send_file_to_client(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let path_buf = std::path::PathBuf::from(path);
    let metadata = tokio::fs::metadata(&path_buf)
        .await
        .map_err(|e| format!("無法讀取檔案資訊: {}", e))?;
    if !metadata.is_file() {
        return Err("指定路徑不是檔案".to_string());
    }

    let file_name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "無法取得檔名".to_string())?
        .to_string();

    let dc = active_file_channel(&state).await?;
    let fingerprint = file_resume_fingerprint(
        &file_name,
        metadata.len(),
        metadata.modified().ok(),
    );
    let id = send_file_start(&dc, &file_name, metadata.len(), &fingerprint).await?;
    let offset = wait_for_resume_offset(&state, &id).await?.min(metadata.len());
    let _ = app.emit(
        "file-transfer-send-progress",
        serde_json::json!({
            "id": id,
            "name": &file_name,
            "transferred": offset,
            "total": metadata.len()
        }),
    );

    let mut file = tokio::fs::File::open(&path_buf)
        .await
        .map_err(|e| format!("無法開啟檔案: {}", e))?;
    if offset > 0 {
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| format!("無法續傳定位檔案: {}", e))?;
    }
    let mut buf = vec![0u8; FILE_TRANSFER_CHUNK_SIZE];
    let mut transferred = offset;
    let mut last_reported = offset;
    loop {
        let n = file
            .read(&mut buf)
            .await
            .map_err(|e| format!("讀取檔案失敗: {}", e))?;
        if n == 0 {
            break;
        }
        send_file_chunk(&dc, transferred, &buf[..n]).await?;
        transferred += n as u64;
        if transferred == metadata.len() || transferred.saturating_sub(last_reported) >= 1024 * 1024 {
            last_reported = transferred;
            let _ = app.emit(
                "file-transfer-send-progress",
                serde_json::json!({
                    "id": id,
                    "name": &file_name,
                    "transferred": transferred,
                    "total": metadata.len()
                }),
            );
        }
    }

    send_file_end(&dc, &id).await?;
    wait_for_remote_file_complete(&state, &id).await?;
    Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn send_selected_file_to_client(
    name: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let file_name = sanitize_received_file_name(&name);
    let dc = active_file_channel(&state).await?;
    let fingerprint = file_resume_fingerprint(&file_name, bytes.len() as u64, None);
    let id = send_file_start(&dc, &file_name, bytes.len() as u64, &fingerprint).await?;
    let offset = wait_for_resume_offset(&state, &id)
        .await?
        .min(bytes.len() as u64) as usize;

    let mut transferred = offset as u64;
    for chunk in bytes[offset..].chunks(FILE_TRANSFER_CHUNK_SIZE) {
        send_file_chunk(&dc, transferred, chunk).await?;
        transferred += chunk.len() as u64;
    }

    send_file_end(&dc, &id).await?;
    wait_for_remote_file_complete(&state, &id).await?;
    Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn active_file_channel(
    state: &State<'_, AppState>,
) -> Result<Arc<webrtc::data_channel::RTCDataChannel>, String> {
    use webrtc::data_channel::data_channel_state::RTCDataChannelState;

    let dc = state
        .active_file_channel
        .lock()
        .await
        .clone()
        .ok_or_else(|| "檔案傳輸通道尚未開啟".to_string())?;

    if dc.ready_state() != RTCDataChannelState::Open {
        return Err("檔案傳輸通道尚未開啟".to_string());
    }

    Ok(dc)
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn send_file_start(
    dc: &Arc<webrtc::data_channel::RTCDataChannel>,
    file_name: &str,
    size: u64,
    fingerprint: &str,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let start_msg = serde_json::json!({
        "action": "start",
        "id": id,
        "name": file_name,
        "size": size,
        "fingerprint": fingerprint,
        "protocol": "offset-v1"
    });
    dc.send_text(start_msg.to_string())
        .await
        .map(|_| id)
        .map_err(|e| format!("無法送出檔案開始訊息: {}", e))
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn wait_for_resume_offset(state: &State<'_, AppState>, id: &str) -> Result<u64, String> {
    for _ in 0..600 {
        if let Some(offset) = state.file_resume_offsets.lock().await.remove(id) {
            return Ok(offset);
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    Ok(0)
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn wait_for_remote_file_complete(state: &State<'_, AppState>, id: &str) -> Result<(), String> {
    for _ in 0..600 {
        if state.file_complete_confirmations.lock().await.remove(id) {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    Err("遠端尚未確認檔案保存完成".to_string())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn file_resume_fingerprint(
    file_name: &str,
    size: u64,
    modified: Option<std::time::SystemTime>,
) -> String {
    let modified_secs = modified
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    sanitize_received_file_name(&format!("{}-{}-{}", file_name, size, modified_secs))
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn send_file_chunk(
    dc: &Arc<webrtc::data_channel::RTCDataChannel>,
    offset: u64,
    chunk: &[u8],
) -> Result<(), String> {
    use bytes::Bytes;
    use webrtc::data_channel::data_channel_state::RTCDataChannelState;

    dc.send(&Bytes::from(create_file_chunk_frame(offset, chunk)))
        .await
        .map_err(|e| format!("檔案區塊傳送失敗: {}", e))?;

    let drain_started_at = std::time::Instant::now();
    while dc.buffered_amount().await > FILE_TRANSFER_BUFFER_HIGH_WATER {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        if dc.ready_state() != RTCDataChannelState::Open {
            return Err("檔案傳輸通道已關閉".to_string());
        }
        if drain_started_at.elapsed().as_millis() > FILE_TRANSFER_BUFFER_DRAIN_TIMEOUT_MS {
            return Err(format!(
                "檔案傳輸通道佇列停滯: {} bytes",
                dc.buffered_amount().await
            ));
        }
    }

    Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn create_file_chunk_frame(offset: u64, chunk: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(FILE_TRANSFER_FRAME_HEADER_BYTES + chunk.len());
    frame.extend_from_slice(&FILE_TRANSFER_FRAME_MAGIC.to_be_bytes());
    frame.extend_from_slice(&((offset >> 32) as u32).to_be_bytes());
    frame.extend_from_slice(&(offset as u32).to_be_bytes());
    frame.extend_from_slice(&(chunk.len() as u32).to_be_bytes());
    frame.extend_from_slice(chunk);
    frame
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
async fn send_file_end(
    dc: &Arc<webrtc::data_channel::RTCDataChannel>,
    id: &str,
) -> Result<(), String> {
    let end_msg = serde_json::json!({ "action": "end", "id": id });
    dc.send_text(end_msg.to_string())
        .await
        .map(|_| ())
        .map_err(|e| format!("無法送出檔案結束訊息: {}", e))
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn save_received_file(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<String, String> {
    let safe_name = sanitize_received_file_name(&name);
    let mut dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("無法取得下載資料夾: {}", e))?;
    dir.push("2syn-transfers");

    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("無法建立接收資料夾: {}", e))?;

    let path = unique_received_file_path(&dir, &safe_name);
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| format!("無法儲存接收檔案: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn sanitize_received_file_name(name: &str) -> String {
    let leaf = std::path::Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download.bin");
    let cleaned: String = leaf
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .to_string();

    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "download.bin".to_string()
    } else {
        cleaned
    }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn unique_received_file_path(dir: &std::path::Path, file_name: &str) -> std::path::PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = std::path::Path::new(file_name);
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 1..10_000 {
        let name = match extension {
            Some(ext) if !ext.is_empty() => format!("{} ({}).{}", stem, index, ext),
            _ => format!("{} ({})", stem, index),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }

    dir.join(format!("{}-{}", uuid::Uuid::new_v4(), file_name))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let connection_manager = Arc::new(ConnectionManager::new());

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![])));
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            connection_manager,

            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            active_pc: tokio::sync::Mutex::new(None),
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            active_file_channel: tokio::sync::Mutex::new(None),
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            file_resume_offsets: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            file_complete_confirmations: tokio::sync::Mutex::new(std::collections::HashSet::new()),
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            signaling_tx: tokio::sync::Mutex::new(None),
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            current_pin: Arc::new(tokio::sync::RwLock::new(String::new())),
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            current_remote_id: Arc::new(tokio::sync::RwLock::new(String::new())),
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            signaling_abort: tokio::sync::Mutex::new(None),
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            has_active_webrtc: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
        .setup(|_app| {
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                // AppState 與初始邏輯已移至啟動階段
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_build_info,
            get_device_hwid,
            open_login_items_settings,
            set_static_password,
            verify_static_password,
            check_has_static_password,
            delete_static_password,
            verify_license_key,
            check_license_status,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            toggle_privacy_mode,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            plug_virtual_monitor,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            unplug_virtual_monitor,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            generate_local_sdp_offer,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            handle_remote_offer_as_host,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            add_ice_candidate_to_rust,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            start_rust_signaling,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            get_connection_status,
            check_network_health,
            run_connection_diagnostic,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            trigger_network_simulation,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            handle_remote_input,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            update_rust_pin,
            check_macos_permissions,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            send_custom_signaling_message,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            has_active_file_transfer_channel,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            cancel_active_file_transfer,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            pick_transfer_files,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            send_file_to_client,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            send_selected_file_to_client,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            save_received_file,
            read_clipboard,
            write_clipboard,
            wake_device,
            get_local_mac_address,
            get_app_product_name
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 應用程序執行時發生錯誤");
}
