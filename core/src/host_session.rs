use std::sync::Arc;
use crate::engine::{CoreEngine, EngineEvent};
use crate::connection::WebRtcSession;
use crate::file_transfer::FileTransferState;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
impl CoreEngine {
    pub async fn setup_host_session(
        self: &Arc<Self>,
        offer_sdp: String,
        turn_servers: Option<Vec<crate::turn::TurnServerConfig>>,
    ) -> Result<String, String> {
    use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

    let session = crate::connection::WebRtcSession::create_session(crate::turn::resolve_ice_servers(turn_servers))
        .await
        .map_err(|e| e.to_string())?;

    crate::debug_log!("TAURI", "Adding video track");
    // 加入視訊軌道並啟動擷取迴圈
    let video_track = session.add_video_track().await.map_err(|e| e.to_string())?;
    crate::debug_log!("TAURI", "Adding foveated video track");
    let foveated_track = session.add_foveated_video_track().await.ok(); // 如果失敗就當作 None

    crate::debug_log!("TAURI", "Creating VideoStreamer");
    let mut streamer = crate::video::VideoStreamer::new(video_track, foveated_track).map_err(|e| e.to_string())?;
    crate::debug_log!("TAURI", "VideoStreamer created");

    // 加入音訊軌道並啟動擷取迴圈 (P1-A)
    crate::debug_log!("TAURI", "Adding audio track");
    let audio_track = session.add_audio_track().await.map_err(|e| e.to_string())?;
    crate::debug_log!("TAURI", "Creating AudioStreamer");
    let audio_streamer =
        crate::audio::AudioStreamer::new(audio_track).map_err(|e| e.to_string())?;
    crate::debug_log!("TAURI", "AudioStreamer created");
    
    let engine_inner = Arc::clone(self);
    let active_webrtc = self.has_active_webrtc.clone();
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
    let engine_inner = Arc::clone(self);
    tokio::spawn(async move {
        while let Some(msg) = status_rx.recv().await {
            engine_inner.emit(EngineEvent::VideoStatus(msg));
        }
    });

    let engine_inner = Arc::clone(self);
    let config_rx = engine_inner.connection_manager.subscribe();

    // 建立監聽螢幕切換的 watch channel
    let (monitor_tx, monitor_rx) = tokio::sync::watch::channel(0usize);

    // 建立系統控制通道。螢幕列表先透過 Tauri runtime API 取得，再交給 core 在
    // DataChannel 開啟時送出；避免在 WebRTC callback 背景執行緒直接碰 xcap/NSScreen。
    let monitor_list_msg = None;
    if let Err(e) = session.setup_system_control_channel(monitor_tx, monitor_list_msg).await {
        eprintln!(
            "[SystemControl] Failed to setup system control channel: {}",
            e
        );
    }

    // 啟動 ABR 網路指標監控與位元率動態決策任務
    crate::connection::ConnectionManager::spawn_monitor_task(
        engine_inner.connection_manager.clone(),
        session.get_peer_connection(),
    );

    let active_webrtc = self.has_active_webrtc.clone();
    let session_alive_video = Arc::clone(&session_alive);
    crate::debug_log!("TAURI", "Starting video capture loop");

    streamer
        .start_capture_loop(Some(status_tx), config_rx, monitor_rx, active_webrtc, session_alive_video)
        .await;
    crate::debug_log!("TAURI", "Video capture loop started");

    let pc = session.get_peer_connection();

    // 監聽本機產生的 ICE Candidate。優先透過 Rust 後端信令直接發送，若未啟動則透過 Tauri Event 拋給前端。
    let engine_inner = Arc::clone(self);
    pc.on_ice_candidate(Box::new(
        move |c: Option<webrtc::ice_transport::ice_candidate::RTCIceCandidate>| {
            let engine_inner = Arc::clone(&engine_inner);
            if let Some(candidate) = c {
                if let Ok(json) = candidate.to_json() {
                    let engine_inner = Arc::clone(&engine_inner);
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
                        
                        let remote_id = engine_inner.current_remote_id.read().await.clone();
                        let tx_opt = engine_inner.signaling_tx.lock().await.clone();
                        if !remote_id.is_empty() {
                            if let Some(tx) = tx_opt {
                                let ice_msg = serde_json::json!({
                                    "type": "ice",
                                    "target": remote_id,
                                    "candidate": serde_json::to_string(&json_for_event).unwrap()
                                });
                                if tx.send(ice_msg.to_string()).await.is_ok() {
                                    println!("Rust 信令已發送本機 ICE Candidate 至 {}", remote_id);
                                    return;
                                }
                            }
                        }
                        
                    });
                }
            }
            Box::pin(async {})
        },
    ));

    let engine_inner = Arc::clone(self);
    // 捕捉本 session 的 pc identity：`has_active_webrtc` 是全域共享旗標，
    // 若讓「洩漏的舊 session」或 iOS ICE 短暫抖動的斷線事件把它打成 false，
    // 目前活躍 session 的 video 擷取迴圈會誤以為連線已斷而停止產生影格
    // → 畫面凍結在 fps 0.0 且永不恢復（Connected 不會再次觸發）。
    // 因此「設 false」必須限定於本 pc 確實是當前 active_pc 時才生效。
    let pc_for_state = Arc::clone(&pc);
    let session_alive_state = Arc::clone(&session_alive);
    pc.on_peer_connection_state_change(Box::new(
        move |state: webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState| {
            engine_inner.emit(EngineEvent::WebRtcStateChange(state.to_string()));
            let state_val = state;
            let engine_inner = Arc::clone(&engine_inner);
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
                let app_state = engine_inner;
                if matches!(state_val, RTCPeerConnectionState::Connected) {
                    // 連上：一律標記活躍（安全方向，讓影像流動）
                    app_state.has_active_webrtc
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                    println!("WebRTC 狀態變更: {:?}, 是否活躍: true", state_val);
                } else if matches!(state_val, RTCPeerConnectionState::Disconnected) {
                    // Disconnected 可能只是 ICE 短暫抖動；此時 data channel/input 仍可能可用。
                    // 若立刻把全域 active flag 關掉，host 擷取 loop 會停止產生影格，
                    // client 端就會永久停在最後一張畫面，但滑鼠/鍵盤仍會在 host 端生效。
                    println!("WebRTC 狀態變更: {:?}，視為暫時抖動，保持影像擷取活躍", state_val);
                } else if matches!(state_val, RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed) {
                    // 失敗/關閉：僅當本 pc 仍是當前 active session 時才標記非活躍。
                    let is_current = app_state.active_pc
                        .lock()
                        .await
                        .as_ref()
                        .map(|cur| Arc::ptr_eq(cur, &pc_self))
                        .unwrap_or(false);
                    if is_current {
                        app_state.has_active_webrtc
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

    let engine_inner = Arc::clone(self);
    let pc_for_ice = Arc::clone(&pc);
    let session_alive_ice = Arc::clone(&session_alive);
    pc.on_ice_connection_state_change(Box::new(
        move |ice_state: webrtc::ice_transport::ice_connection_state::RTCIceConnectionState| {
            let engine_inner = Arc::clone(&engine_inner);
            let pc_self = Arc::clone(&pc_for_ice);
            let session_alive = Arc::clone(&session_alive_ice);
            Box::pin(async move {
                use webrtc::ice_transport::ice_connection_state::RTCIceConnectionState;
                let app_state = engine_inner;
                let is_current = app_state.active_pc
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
                    app_state.has_active_webrtc
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                    println!("ICE 狀態變更: {:?}, 是否活躍: true", ice_state);
                } else if matches!(ice_state, RTCIceConnectionState::Failed | RTCIceConnectionState::Closed) {
                    session_alive.store(false, std::sync::atomic::Ordering::SeqCst);
                    app_state.has_active_webrtc
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
    let engine_inner = Arc::clone(self);
    let pc_for_data_channel = Arc::clone(&pc);
    let session_alive_data_channel = Arc::clone(&session_alive);

    pc.on_data_channel(Box::new(move |d| {
        let label = d.label().to_owned();
        let engine_inner = Arc::clone(&engine_inner);
        let pc_self = Arc::clone(&pc_for_data_channel);
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
                    use crate::input::SecureInputPacket;
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
                    use crate::input::SecureInputPacket;
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
            let engine_inner = Arc::clone(&engine_inner);
            let dc_for_system = Arc::clone(&d);
            let pc_for_system = Arc::clone(&pc_self);
            let session_alive_for_system = Arc::clone(&session_alive);
            d.on_message(Box::new(move |msg| {
                let data = msg.data.to_vec();
                let engine_inner = Arc::clone(&engine_inner);
                let dc = Arc::clone(&dc_for_system);
                let pc_self = Arc::clone(&pc_for_system);
                let session_alive = Arc::clone(&session_alive_for_system);
                Box::pin(async move {
                    if let Ok(text) = String::from_utf8(data) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                            if json["type"] == "file_transfer_priority" {
                                let active = json["active"].as_bool().unwrap_or(false);
                                
                                engine_inner.connection_manager.set_transfer_priority(active).await;
                                println!(
                                    "[file-transfer] Transfer priority mode {}",
                                    if active { "enabled" } else { "disabled" }
                                );
                            } else if json["type"] == "input_ping" {
                                let pong = serde_json::json!({
                                    "type": "input_pong",
                                    "sentAt": json["sentAt"],
                                });
                                if let Err(error) = dc.send_text(pong.to_string()).await {
                                    eprintln!("[input-health] Failed to send input pong: {}", error);
                                }
                            } else if json["type"] == "session_disconnect" {
                                let old_pc = {
                                    let mut active_pc = engine_inner.active_pc.lock().await;
                                    if active_pc
                                        .as_ref()
                                        .map(|cur| Arc::ptr_eq(cur, &pc_self))
                                        .unwrap_or(false)
                                    {
                                        active_pc.take()
                                    } else {
                                        None
                                    }
                                };

                                if let Some(pc) = old_pc {
                                    session_alive.store(false, std::sync::atomic::Ordering::SeqCst);
                                    engine_inner
                                        .has_active_webrtc
                                        .store(false, std::sync::atomic::Ordering::SeqCst);
                                    *engine_inner.current_remote_id.write().await = String::new();
                                    *engine_inner.active_session_id.write().await = String::new();
                                    *engine_inner.active_file_channel.lock().await = None;
                                    *engine_inner.active_file_control_channel.lock().await = None;
                                    engine_inner.active_file_data_channels.lock().await.clear();
                                    *engine_inner.file_receive_state.lock().await = None;
                                    engine_inner.file_resume_offsets.lock().await.clear();
                                    engine_inner.file_complete_confirmations.lock().await.clear();
                                    engine_inner.active_file_send_ids.lock().await.clear();
                                    engine_inner.file_cancelled_transfers.lock().await.clear();
                                    if let Err(error) = pc.close().await {
                                        eprintln!("[WebRTC] Failed to close session after client logout: {}", error);
                                    } else {
                                        println!("[WebRTC] Client logout received; active host session closed");
                                    }
                                } else {
                                    println!("[WebRTC] Client logout received for stale session; ignored");
                                }
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
        } else if label == "file-transfer-control" {
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let receive_download_dir = engine_inner.default_download_dir.clone();
                let file_state = Arc::new(tokio::sync::Mutex::new(
                    crate::file_transfer::FileTransferState::with_download_dir(receive_download_dir),
                ));
                let engine_for_receive = Arc::clone(&engine_inner);
                let state_for_receive = Arc::clone(&file_state);
                tokio::spawn(async move {
                    *engine_for_receive.file_receive_state
                        .lock()
                        .await = Some(state_for_receive);
                });

                let engine_for_control = Arc::clone(&engine_inner);
                let dc_for_initial_state = Arc::clone(&d);
                tokio::spawn(async move {
                    *engine_for_control.active_file_control_channel
                        .lock()
                        .await = Some(dc_for_initial_state);
                });

                let dc_for_state = Arc::clone(&d);
                let engine_for_open = Arc::clone(&engine_inner);
                d.on_open(Box::new(move || {
                    let dc = Arc::clone(&dc_for_state);
                    let engine_inner = Arc::clone(&engine_for_open);
                    Box::pin(async move {
                        *engine_inner.active_file_control_channel.lock().await = Some(dc);
                        println!("[file-transfer] Split control channel is ready");
                    })
                }));

                let engine_for_close = Arc::clone(&engine_inner);
                let dc_for_close = Arc::clone(&d);
                d.on_close(Box::new(move || {
                    let engine_inner = Arc::clone(&engine_for_close);
                    let dc = Arc::clone(&dc_for_close);
                    Box::pin(async move {
                        
                        let mut active = engine_inner.active_file_control_channel.lock().await;
                        if active.as_ref().map(|current| Arc::ptr_eq(current, &dc)).unwrap_or(false) {
                            *active = None;
                        }
                    })
                }));

                let engine_for_msg = Arc::clone(&engine_inner);
                let dc_for_file_events = Arc::clone(&d);
                d.on_message(Box::new(move |msg| {
                    let data = msg.data.to_vec();
                    let file_state = Arc::clone(&file_state);
                    let engine_inner = Arc::clone(&engine_for_msg);
                    let dc = Arc::clone(&dc_for_file_events);
                    Box::pin(async move {
                        let Ok(text_str) = std::str::from_utf8(&data) else { return; };
                        if !text_str.starts_with("{") { return; }
                        *engine_inner.file_receive_state
                            .lock()
                            .await = Some(Arc::clone(&file_state));
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(text_str) {
                            
                        }
                        let mut state = file_state.lock().await;
                        state.handle_message(text_str);
                        for outgoing in state.take_outgoing_messages() {
                            let _ = dc.send_text(outgoing).await;
                        }
                        
                    })
                }));
            }
        } else if label.starts_with("file-transfer-data-") {
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let engine_for_spawn = Arc::clone(&engine_inner);
                let dc_for_initial_state = Arc::clone(&d);
                tokio::spawn(async move {
                    engine_for_spawn.active_file_data_channels
                        .lock()
                        .await
                        .push(dc_for_initial_state);
                });
                let engine_for_close = Arc::clone(&engine_inner);
                let dc_for_close = Arc::clone(&d);
                d.on_close(Box::new(move || {
                    let engine_inner = Arc::clone(&engine_for_close);
                    let dc = Arc::clone(&dc_for_close);
                    Box::pin(async move {
                        engine_inner.active_file_data_channels
                            .lock()
                            .await
                            .retain(|current| !Arc::ptr_eq(current, &dc));
                    })
                }));
                let engine_for_msg = Arc::clone(&engine_inner);
                d.on_message(Box::new(move |msg| {
                    let data = msg.data.to_vec();
                    let engine_inner = Arc::clone(&engine_for_msg);
                    Box::pin(async move {
                        
                        let file_state = engine_inner.file_receive_state.lock().await.clone();
                        let Some(file_state) = file_state else { return; };
                        let mut receiver = file_state.lock().await;
                        receiver.handle_binary(&data);
                        let outgoing = receiver.take_outgoing_messages();
                        
                        drop(receiver);
                        if outgoing.is_empty() { return; }
                        if let Some(control) = engine_inner.active_file_control_channel.lock().await.as_ref() {
                            for message in outgoing {
                                let _ = control.send_text(message).await;
                            }
                        }
                    })
                }));
            }
        } else if label == "file-transfer" {
            // 檔案傳輸 DataChannel
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let engine_for_spawn = Arc::clone(&engine_inner);
                let dc_for_initial_state = Arc::clone(&d);
                tokio::spawn(async move {
                    
                    *engine_for_spawn.active_file_channel.lock().await = Some(dc_for_initial_state);
                });

                let dc_for_state = Arc::clone(&d);
                let engine_for_open = Arc::clone(&engine_inner);
                d.on_open(Box::new(move || {
                    let dc = Arc::clone(&dc_for_state);
                    let engine_inner = Arc::clone(&engine_for_open);
                    Box::pin(async move {
                        
                        *engine_inner.active_file_channel.lock().await = Some(dc);
                        println!("[file-transfer] Active file channel is ready");
                    })
                }));

                let engine_for_close = Arc::clone(&engine_inner);
                let dc_for_close = Arc::clone(&d);
                d.on_close(Box::new(move || {
                    let engine_inner = Arc::clone(&engine_for_close);
                    let dc = Arc::clone(&dc_for_close);
                    Box::pin(async move {
                        
                        let mut active = engine_inner.active_file_channel.lock().await;
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
            let receive_download_dir = engine_inner.default_download_dir.clone();
            let file_state = Arc::new(tokio::sync::Mutex::new(
                crate::file_transfer::FileTransferState::with_download_dir(receive_download_dir),
            ));
            let engine_for_msg = Arc::clone(&engine_inner);
            let dc_for_file_events = Arc::clone(&d);
            d.on_message(Box::new(move |msg| {
                let data = msg.data.to_vec();
                let file_state = Arc::clone(&file_state);
                let engine_inner = Arc::clone(&engine_for_msg);
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
                                        let app_state = Arc::clone(&engine_inner);
                                        app_state.file_resume_offsets
                                            .lock()
                                            .await
                                            .insert(id.to_string(), offset);
                                    }
                                } else if value.get("action").and_then(|value| value.as_str()) == Some("complete") {
                                    if let Some(id) = value.get("id").and_then(|value| value.as_str()) {
                                        let app_state = Arc::clone(&engine_inner);
                                        app_state.file_complete_confirmations
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
                                engine_inner.emit(EngineEvent::FileTransferComplete { name: completed.name });
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
    let engine_inner = Arc::clone(self);
    let old_pc = engine_inner.active_pc.lock().await.replace(Arc::clone(&pc));
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
}
