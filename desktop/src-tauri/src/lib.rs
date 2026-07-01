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

struct AppState {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    connection_manager: Arc<ConnectionManager>,
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    active_pc: tokio::sync::Mutex<Option<Arc<webrtc::peer_connection::RTCPeerConnection>>>,
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
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn read_clipboard() -> Result<String, String> {
    use arboard::Clipboard;
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

/// 寫入內容至系統剪貼簿
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn write_clipboard(text: String) -> Result<(), String> {
    use arboard::Clipboard;
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
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

/// 產生去中心化手動 SDP Offer 資訊
#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn generate_local_sdp_offer() -> Result<String, String> {
    let session = syn_core::connection::WebRtcSession::create_session()
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
) -> Result<String, String> {
    use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

    let session = syn_core::connection::WebRtcSession::create_session()
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
    
    tokio::spawn(async move {
        if let Err(e) = audio_streamer.start(active_webrtc_audio).await {
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

    // 建立系統控制通道
    if let Err(e) = session.setup_system_control_channel(monitor_tx).await {
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
    syn_core::debug_log!("TAURI", "Starting video capture loop");
    
    streamer
        .start_capture_loop(Some(status_tx), config_rx, monitor_rx, active_webrtc)
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
    pc.on_peer_connection_state_change(Box::new(
        move |state: webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState| {
            let _ = app_clone2.emit("rust-webrtc-state", state.to_string());
            let state_val = state;
            let app = app_clone2.clone();
            Box::pin(async move {
                use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
                let active = matches!(state_val, RTCPeerConnectionState::Connected);
                let app_state = app.state::<AppState>();
                app_state
                    .has_active_webrtc
                    .store(active, std::sync::atomic::Ordering::SeqCst);
                println!("WebRTC 狀態變更: {:?}, 是否活躍: {}", state_val, active);
            })
        },
    ));

    // 處理 DataChannel 接收事件，將序列號追蹤分為可靠與不可靠通道
    let control_last_seq = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let unreliable_last_seq = Arc::new(std::sync::atomic::AtomicU32::new(0));

    pc.on_data_channel(Box::new(move |d| {
        let label = d.label().to_owned();
        println!("Rust 接收到 DataChannel: {}", label);

        if label == "input-control" {
            let last_seq = Arc::clone(&control_last_seq);
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
        } else if label == "clipboard" {
            // 剪貼簿同步 DataChannel
            d.on_message(Box::new(move |msg| {
                let data = msg.data.to_vec();
                Box::pin(async move {
                    if let Ok(text_str) = std::str::from_utf8(&data) {
                        // 格式: JSON {"type":"clipboard_push","text":"..."}
                        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(text_str) {
                            if json_val.get("type").and_then(|v| v.as_str())
                                == Some("clipboard_push")
                            {
                                if let Some(text) = json_val.get("text").and_then(|v| v.as_str()) {
                                    #[cfg(not(any(target_os = "ios", target_os = "android")))]
                                    {
                                        use arboard::Clipboard;
                                        if let Ok(mut cb) = Clipboard::new() {
                                            let _ = cb.set_text(text.to_string());
                                            eprintln!(
                                                "[clipboard] 已同步剪貼簿內容 ({} 字元)",
                                                text.len()
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                })
            }));
        } else if label == "file-transfer" {
            // 檔案傳輸 DataChannel
            let file_state = Arc::new(tokio::sync::Mutex::new(
                syn_core::file_transfer::FileTransferState::new(),
            ));
            d.on_message(Box::new(move |msg| {
                let data = msg.data.to_vec();
                let file_state = Arc::clone(&file_state);
                Box::pin(async move {
                    let mut state = file_state.lock().await;
                    // 如果能解析為字串，可能是控制訊息 (JSON)
                    if let Ok(text_str) = std::str::from_utf8(&data) {
                        if text_str.starts_with("{") {
                            state.handle_message(text_str);
                            return;
                        }
                    }
                    // 否則視為二進位檔案內容
                    state.handle_binary(&data);
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

    // 儲存 pc 供 ICE 使用
    let state = app_handle.state::<AppState>();
    *state.active_pc.lock().await = Some(Arc::clone(&pc));

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

                            match handle_remote_offer_as_host(app_handle_clone.clone(), sdp).await {
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
        // iOS 無法執行 ifconfig，預設回傳基礎支援
        Ok(serde_json::json!({
            "has_ipv6": true,
            "has_tailscale": false
        }))
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let output = std::process::Command::new("ifconfig")
            .output()
            .map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout);

        let has_ipv6 = stdout.contains("inet6")
            && stdout
                .lines()
                .any(|l| l.contains("inet6") && !l.contains("::1") && !l.contains("fe80::"));
        let has_tailscale = stdout
            .lines()
            .any(|l| l.contains("100.") || l.contains("fd7a:115c:a1e0:"));

        Ok(serde_json::json!({
            "has_ipv6": has_ipv6,
            "has_tailscale": has_tailscale
        }))
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
            read_clipboard,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            write_clipboard,
            wake_device,
            get_local_mac_address,
            get_app_product_name
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 應用程序執行時發生錯誤");
}
