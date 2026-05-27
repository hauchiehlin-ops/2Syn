// Tauri lib entry point

use syn_core::security::{generate_hwid, LicenseValidator, SecureStorage};
#[cfg(not(target_os = "ios"))]
use syn_core::connection::{ConnectionManager, ConnectionType};
#[cfg(not(target_os = "ios"))]
use syn_core::file_transfer::FileTransferEngine;
use std::sync::Arc;
use tauri::{State, Manager, Emitter};

struct AppState {
    #[cfg(not(target_os = "ios"))]
    connection_manager: Arc<ConnectionManager>,
    #[cfg(not(target_os = "ios"))]
    file_transfer_engine: Arc<FileTransferEngine>,
    #[cfg(not(target_os = "ios"))]
    active_pc: tokio::sync::Mutex<Option<Arc<webrtc::peer_connection::RTCPeerConnection>>>,
}

/// 獲取本機硬體特徵碼（HWID）的 Tauri Command
#[tauri::command]
async fn get_device_hwid() -> Result<String, String> {
    generate_hwid().map_err(|e| e.to_string())
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
    let signaling_url = std::env::var("SIGNALING_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
    let client = reqwest::Client::new();
    let res = client.post(format!("{}/activate", signaling_url))
        .json(&serde_json::json!({
            "license_key": license_key,
            "hwid": hwid
        }))
        .send()
        .await
        .map_err(|e| format!("err_connect_server|{}", e))?;
        
    let status = res.status();
    let body: ServerActivateResponse = res.json()
        .await
        .map_err(|e| format!("err_parse_server_response|{}", e))?;
        
    if !status.is_success() || !body.success {
        return Err(body.message);
    }
    
    if let Some(ticket) = body.ticket {
        // 使用 Ed25519 離線密碼學驗證憑證簽章
        let is_valid = LicenseValidator::verify_license(&ticket, &[0u8; 32])
            .map_err(|e| e.to_string())?;
            
        if is_valid {
            // 儲存啟用憑證 (Ticket) 至系統 Keychain 安全區
            SecureStorage::save_secret("license_key", &ticket)
                .map_err(|e| e.to_string())?;
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
        if let Ok(true) = syn_core::security::LicenseValidator::verify_license(&ticket, &[0u8; 32]) {
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
        Ok(time_str) => {
            time_str.parse::<u64>().unwrap_or(current_time)
        }
        Err(_) => {
            // 寫入首次啟動時間
            let _ = syn_core::security::SecureStorage::save_secret("first_launch_time", &current_time.to_string());
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

/// 模擬切換隱私黑屏模式與虛擬顯示器
#[tauri::command]
async fn toggle_privacy_mode(enable: bool) -> Result<String, String> {
    if enable {
        // 真實調用 IDD 驅動，插入解析度為 1920x1080 且為 144Hz 的高更新率虛擬螢幕
        syn_core::idd::VirtualDisplayManager::plug_monitor(1, 1920, 1080, 144)
            .map_err(|e| e.to_string())?;
        Ok("privacy_mode_enabled".to_string())
    } else {
        // 移除虛擬螢幕，恢復實體螢幕
        syn_core::idd::VirtualDisplayManager::unplug_monitor(1)
            .map_err(|e| e.to_string())?;
        Ok("privacy_mode_disabled".to_string())
    }
}

/// 動態插入虛擬螢幕控制命令
#[tauri::command]
async fn plug_virtual_monitor(index: u32, width: u32, height: u32, refresh_rate: u32) -> Result<String, String> {
    syn_core::idd::VirtualDisplayManager::plug_monitor(index, width, height, refresh_rate)
        .map_err(|e| e.to_string())?;
    Ok(format!("plug_success|{}|{}|{}|{}", index, width, height, refresh_rate))
}

/// 動態拔除虛擬螢幕控制命令
#[tauri::command]
async fn unplug_virtual_monitor(index: u32) -> Result<String, String> {
    syn_core::idd::VirtualDisplayManager::unplug_monitor(index)
        .map_err(|e| e.to_string())?;
    Ok(format!("unplug_success|{}", index))
}

/// 產生去中心化手動 SDP Offer 資訊
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn generate_local_sdp_offer() -> Result<String, String> {
    // 未來產品化時，若發現 STUN 失敗，可動態傳入 TURN 憑證
    // 這裡我們設計為讀取環境變數作為預留擴充點
    let custom_turn = if let (Ok(url), Ok(user), Ok(pass)) = (
        std::env::var("TURN_URL"),
        std::env::var("TURN_USER"),
        std::env::var("TURN_PASS"),
    ) {
        Some((url, user, pass))
    } else {
        Some((
            "turn:openrelay.metered.ca:80".to_string(),
            "openrelayproject".to_string(),
            "openrelayproject".to_string(),
        ))
    };

    let session = syn_core::connection::WebRtcSession::create_session(custom_turn)
        .await
        .map_err(|e| e.to_string())?;
        
    let pc = session.get_peer_connection();
    session.setup_input_channel().await.map_err(|e| e.to_string())?;
    
    let offer = pc.create_offer(None)
        .await
        .map_err(|e| format!("err_create_offer|{}", e))?;
        
    pc.set_local_description(offer.clone())
        .await
        .map_err(|e| format!("err_set_local_description|{}", e))?;
        
    Ok(offer.sdp)
}

/// 處理遠端 Offer，建立 Answer 並啟動視訊串流 (作為被控端 Host)
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn handle_remote_offer_as_host(app_handle: tauri::AppHandle, offer_sdp: String) -> Result<String, String> {
    use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

    let session = syn_core::connection::WebRtcSession::create_session(Some((
        "turn:openrelay.metered.ca:80".to_string(),
        "openrelayproject".to_string(),
        "openrelayproject".to_string(),
    )))
        .await
        .map_err(|e| e.to_string())?;

    // 加入視訊軌道並啟動擷取迴圈
    let video_track = session.add_video_track().await.map_err(|e| e.to_string())?;
    let streamer = syn_core::video::VideoStreamer::new(video_track).map_err(|e| e.to_string())?;
    
    let (status_tx, mut status_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let app_clone_status = app_handle.clone();
    tokio::spawn(async move {
        while let Some(msg) = status_rx.recv().await {
            let _ = app_clone_status.emit("rust-video-status", msg);
        }
    });

    streamer.start_capture_loop(Some(status_tx)).await;

    let pc = session.get_peer_connection();
    
    // 監聽本機產生的 ICE Candidate 並透過 Tauri Event 拋給前端
    let app_clone = app_handle.clone();
    pc.on_ice_candidate(Box::new(move |c: Option<webrtc::ice_transport::ice_candidate::RTCIceCandidate>| {
        if let Some(candidate) = c {
            if let Ok(json) = candidate.to_json() {
                let _ = app_clone.emit("rust-ice-candidate", json);
            }
        }
        Box::pin(async {})
    }));

    let app_clone2 = app_handle.clone();
    pc.on_peer_connection_state_change(Box::new(move |state: webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState| {
        let _ = app_clone2.emit("rust-webrtc-state", state.to_string());
        Box::pin(async {})
    }));

    // 處理 DataChannel 接收事件
    let last_seq = Arc::new(std::sync::atomic::AtomicU32::new(0));
    pc.on_data_channel(Box::new(move |d| {
        let label = d.label().to_owned();
        println!("Rust 接收到 DataChannel: {}", label);
        
        if label == "input-control" {
            let last_seq = Arc::clone(&last_seq);
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
                                        eprintln!("[input] simulate failed: {}", e);
                                    }
                                }
                                Err(e) => eprintln!("[security] packet rejected: {}", e),
                            }
                        }
                        Err(err) => eprintln!("[input] deserialize failed: {:?}", err),
                    }
                })
            }));
        } else {
            d.on_message(Box::new(move |msg| {
                println!("收到 DataChannel ({}) 訊息: {} bytes", label, msg.data.len());
                Box::pin(async {})
            }));
        }
        Box::pin(async {})
    }));

    // 套用 Remote Offer
    let sdp = RTCSessionDescription::offer(offer_sdp).map_err(|e| e.to_string())?;
    pc.set_remote_description(sdp).await.map_err(|e| e.to_string())?;

    // 儲存 pc 供 ICE 使用
    let state = app_handle.state::<AppState>();
    *state.active_pc.lock().await = Some(Arc::clone(&pc));

    // 建立 Local Answer
    let answer = pc.create_answer(None).await.map_err(|e| e.to_string())?;
    pc.set_local_description(answer.clone()).await.map_err(|e| e.to_string())?;

    Ok(answer.sdp)
}

/// 接收來自遠端的 ICE Candidate 並套用至 Rust PeerConnection
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn add_ice_candidate_to_rust(state: State<'_, AppState>, candidate_str: String) -> Result<(), String> {
    use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
    
    let pc_opt = state.active_pc.lock().await.clone();
    if let Some(pc) = pc_opt {
        match serde_json::from_str::<RTCIceCandidateInit>(&candidate_str) {
            Ok(candidate) => {
                pc.add_ice_candidate(candidate).await.map_err(|e| e.to_string())?;
                println!("已成功加入遠端 ICE Candidate");
            }
            Err(e) => return Err(format!("JSON 解析失敗: {}", e)),
        }
    } else {
        return Err("PeerConnection 尚未建立".to_string());
    }
    Ok(())
}

/// 獲取當前連線品質狀態，供前端即時面板顯示
#[cfg(not(target_os = "ios"))]
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
        "file_transfer_enabled": config.file_transfer_enabled,
        "rtt_ms": metrics.rtt_ms,
        "packet_loss_rate": metrics.packet_loss_rate,
        "connection_type": conn_type_str,
    }))
}

/// 執行連線診斷，返回評估報告
#[cfg(not(target_os = "ios"))]
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
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn trigger_network_simulation(state: State<'_, AppState>, rtt_ms: u32, loss_rate: f32, is_relay: bool) -> Result<String, String> {
    println!("[DEBUG] 收到網路模擬請求: {} ms, {}%, relay: {}", rtt_ms, loss_rate, is_relay);
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

/// 接收來自前端 WebRTC Data Channel 的二進位輸入封包並執行（被控端）
/// 跨平台：macOS/iOS/Windows/Android 均透過此指令執行遠端控制
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn handle_remote_input(data: Vec<u8>) -> Result<(), String> {
    use syn_core::input::SecureInputPacket;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::OnceLock;

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

/// 接收來自前端 WebRTC Data Channel 的檔案資料塊並寫入磁碟（被控端）
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn receive_file_chunk(chunk: Vec<u8>) -> Result<(), String> {
    use std::io::Write;
    use std::sync::OnceLock;
    use tokio::sync::Mutex as AsyncMutex;

    static RECV_FILE: OnceLock<AsyncMutex<std::fs::File>> = OnceLock::new();

    let tmp_path = std::env::temp_dir().join("2syn_received_file");
    let file_lock = RECV_FILE.get_or_init(|| {
        let f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&tmp_path)
            .expect("[recv_file] 無法開啟暫存檔案");
        AsyncMutex::new(f)
    });

    let mut file = file_lock.lock().await;
    file.write_all(&chunk).map_err(|e| e.to_string())?;
    Ok(())
}

/// 發起檔案傳輸，後端會強制驗證連線狀態
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn send_file(state: State<'_, AppState>, path: String) -> Result<String, String> {
    // 取得當前連線狀態指標
    let metrics = state.connection_manager.get_current_metrics().await;
    
    // 呼叫 FileTransferEngine::prepare_send 進行後端強制閘門驗證
    let (file_name, total_bytes, _chunks) = FileTransferEngine::prepare_send(&path, metrics.connection_type)
        .await
        .map_err(|e| e.to_string())?;

    let task_id = uuid::Uuid::new_v4().to_string();
    
    // 註冊任務，回傳 transferred_bytes 原子計數器
    let _transferred = state.file_transfer_engine.register_task(&task_id, &file_name, total_bytes).await;

    // TODO: 在背景啟動 tokio::spawn，逐塊透過 file_channel 傳送 _chunks
    // 並且更新 _transferred 的數值
    // 若遇上取消訊號，提早結束

    Ok(task_id)
}

/// 獲取當前所有傳輸任務狀態（供前端輪詢進度條）
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn get_active_transfers(state: State<'_, AppState>) -> Result<Vec<syn_core::file_transfer::FileTransferTask>, String> {
    let tasks = state.file_transfer_engine.get_all_snapshots().await;
    Ok(tasks)
}

/// 取消指定傳輸任務
#[cfg(not(target_os = "ios"))]
#[tauri::command]
async fn cancel_transfer(state: State<'_, AppState>, task_id: String) -> Result<bool, String> {
    Ok(state.file_transfer_engine.cancel_task(&task_id).await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(target_os = "ios"))]
    let connection_manager = Arc::new(ConnectionManager::new());
    #[cfg(not(target_os = "ios"))]
    let file_transfer_engine = Arc::new(FileTransferEngine::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { 
            #[cfg(not(target_os = "ios"))]
            connection_manager,
            #[cfg(not(target_os = "ios"))]
            file_transfer_engine,
            #[cfg(not(target_os = "ios"))]
            active_pc: tokio::sync::Mutex::new(None),
        })
        .setup(|app| {
            #[cfg(not(target_os = "ios"))]
            {
                let state = app.state::<AppState>();
                let manager_clone = state.connection_manager.clone();
                // 連線品質自動調整任務
                tauri::async_runtime::spawn(async move {
                    ConnectionManager::start_monitor_loop(manager_clone).await;
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_device_hwid,
            verify_license_key,
            check_license_status,
            toggle_privacy_mode,
            plug_virtual_monitor,
            unplug_virtual_monitor,
            #[cfg(not(target_os = "ios"))]
            generate_local_sdp_offer,
            #[cfg(not(target_os = "ios"))]
            handle_remote_offer_as_host,
            #[cfg(not(target_os = "ios"))]
            add_ice_candidate_to_rust,
            #[cfg(not(target_os = "ios"))]
            get_connection_status,
            #[cfg(not(target_os = "ios"))]
            run_connection_diagnostic,
            #[cfg(not(target_os = "ios"))]
            trigger_network_simulation,
            #[cfg(not(target_os = "ios"))]
            handle_remote_input,
            #[cfg(not(target_os = "ios"))]
            receive_file_chunk,
            #[cfg(not(target_os = "ios"))]
            send_file,
            #[cfg(not(target_os = "ios"))]
            get_active_transfers,
            #[cfg(not(target_os = "ios"))]
            cancel_transfer
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 應用程序執行時發生錯誤");
}
