use crate::CoreError;
use crate::input::SecureInputPacket;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, watch};
use std::time::Duration;

use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;

/// 色彩採樣格式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorFormat {
    Yuv444, // 4:4:4 真彩畫質
    Yuv420, // 4:2:0 標準畫質
}

/// 連線類型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionType {
    P2PDirect,
    Relay,
}

/// 視訊與傳輸品質配置
#[derive(Debug, Clone)]
pub struct QualityConfig {
    pub target_fps: u32,
    pub color_format: ColorFormat,
    pub bitrate_limit_kbps: u32,
    pub target_width: u32,
    pub target_height: u32,
}

impl Default for QualityConfig {
    fn default() -> Self {
        Self {
            target_fps: 60,
            color_format: ColorFormat::Yuv420,
            bitrate_limit_kbps: 8_000, // 預設 8 Mbps
            target_width: 1920, // 預設 1080p（macOS 零拷貝編碼器須匹配顯示器原生尺寸）
            target_height: 1080,
        }
    }
}

/// 網路監控指標
#[derive(Debug, Clone)]
pub struct NetworkMetrics {
    pub rtt_ms: u32,
    pub packet_loss_rate: f32, // 0.0 ~ 1.0
    pub connection_type: ConnectionType,
}

pub struct ConnectionManager {
    current_metrics: Arc<Mutex<NetworkMetrics>>,
    current_config: Arc<Mutex<QualityConfig>>,
    config_tx: watch::Sender<QualityConfig>,
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionManager {
    pub fn new() -> Self {
        let default_config = QualityConfig::default();
        let (config_tx, _) = watch::channel(default_config.clone());

        Self {
            current_metrics: Arc::new(Mutex::new(NetworkMetrics {
                rtt_ms: 10,
                packet_loss_rate: 0.0,
                connection_type: ConnectionType::P2PDirect,
            })),
            current_config: Arc::new(Mutex::new(default_config)),
            config_tx,
        }
    }

    /// 訂閱畫質與網路配置變更
    pub fn subscribe(&self) -> watch::Receiver<QualityConfig> {
        self.config_tx.subscribe()
    }

    /// 更新當前網路狀態指標並執行決策樹
    pub async fn update_metrics(&self, metrics: NetworkMetrics) {
        let mut current_m = self.current_metrics.lock().await;
        *current_m = metrics.clone();
        
        let new_config = self.decide_quality(&metrics);
        let mut current_c = self.current_config.lock().await;
        
        // 只有在配置有變更時才觸發廣播
        if new_config.target_fps != current_c.target_fps
            || new_config.color_format != current_c.color_format
            || new_config.bitrate_limit_kbps != current_c.bitrate_limit_kbps
            || new_config.target_width != current_c.target_width
            || new_config.target_height != current_c.target_height
        {
            *current_c = new_config.clone();
            let _ = self.config_tx.send(new_config);
        }
    }

    /// 動態降級決策樹核心演算法
    fn decide_quality(&self, metrics: &NetworkMetrics) -> QualityConfig {
        let mut config = QualityConfig::default();

        // 1. 判斷連線媒介是否為 Relay
        // （堅持不使用 TURN 策略：不會出現 Relay 狀態，保留分支以備未來擴展如 Tailscale Relay）
        if metrics.connection_type == ConnectionType::Relay {
            config.target_fps = 30;
            config.bitrate_limit_kbps = 2000; // 降低頻寬以適應中繼
            config.color_format = ColorFormat::Yuv420;
            config.target_width = 1280;
            config.target_height = 720;
        }

        // 2. 基於網路指標 (ABR: Adaptive Bitrate) 的動態調整
        // RTT 或 Packet Loss 過高時大幅降速
        if metrics.rtt_ms > 150 || metrics.packet_loss_rate > 0.05 {
            config.target_fps = 30;
            config.bitrate_limit_kbps = 1000;
            config.target_width = 854;
            config.target_height = 480;
        } else if metrics.rtt_ms > 80 || metrics.packet_loss_rate > 0.01 {
            config.target_fps = 60;
            config.bitrate_limit_kbps = 3000;
            config.target_width = 1280;
            config.target_height = 720;
        } else {
            // 網路暢通，提升至最高畫質。
            // 註：macOS 走零拷貝編碼，編碼器尺寸須匹配 SCStream 交付的顯示器原生尺寸，
            // 不可在此擅自下調解析度（否則 IOSurface 尺寸不符導致編碼失敗、整路無畫面）。
            // 真要降解析度須改 SCStreamConfiguration 的輸出尺寸，屬另案。
            config.target_fps = 60;
            config.bitrate_limit_kbps = 8000;
            config.target_width = 1920;
            config.target_height = 1080;
        }

        config
    }

    pub async fn get_current_config(&self) -> QualityConfig {
        self.current_config.lock().await.clone()
    }

    pub async fn get_current_metrics(&self) -> NetworkMetrics {
        self.current_metrics.lock().await.clone()
    }

    pub fn spawn_monitor_task(manager: Arc<Self>, pc: Arc<webrtc::peer_connection::RTCPeerConnection>) {
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(1000)).await;
                
                if pc.connection_state() == webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState::Closed {
                    break;
                }

                let stats = pc.get_stats().await;
                let mut current_rtt = 0u32;
                let mut current_loss = 0.0f32;

                for (_id, stat) in stats.reports.iter() {
                    if let webrtc::stats::StatsReportType::RemoteInboundRTP(rtp_stats) = stat {
                        current_rtt = (rtp_stats.round_trip_time.unwrap_or(0.0) * 1000.0) as u32;
                        current_loss = rtp_stats.fraction_lost as f32;
                        break;
                    }
                }

                // 如果完全沒有收到 RTCP，則使用上一次的數值避免震盪
                let new_metrics = {
                    let current_m = manager.current_metrics.lock().await;
                    NetworkMetrics {
                        rtt_ms: if current_rtt > 0 { current_rtt } else { current_m.rtt_ms },
                        packet_loss_rate: if current_rtt > 0 { current_loss } else { current_m.packet_loss_rate },
                        connection_type: current_m.connection_type.clone(),
                    }
                };

                manager.update_metrics(new_metrics).await;
            }
        });
    }
}

// =========================================================================
// webrtc-rs 原生連線與資料通道整合管道
// =========================================================================

pub struct WebRtcSession {
    peer_connection: Arc<RTCPeerConnection>,
}

impl WebRtcSession {
    /// 建立全新 WebRTC PeerConnection 連線工作階段
    /// 包含高可用性 STUN 清單，完全捨棄 TURN 依賴
    pub async fn create_session() -> Result<Self, CoreError> {
        let mut m = MediaEngine::default();
        m.register_default_codecs()
            .map_err(|e| CoreError::NetworkError(format!("註冊預設編解碼器失敗: {}", e)))?;

        let api = APIBuilder::new()
            .with_media_engine(m)
            .build();

        // 高可用性 STUN 清單 (堅持不使用 TURN 以符合架構設計)
        let ice_servers = vec![
            RTCIceServer {
                urls: vec![
                    "stun:stun.l.google.com:19302".to_string(),
                    "stun:stun1.l.google.com:19302".to_string(),
                    "stun:stun.cloudflare.com:3478".to_string(),
                ],
                ..Default::default()
            }
        ];

        let config = RTCConfiguration {
            ice_servers,
            ..Default::default()
        };

        let peer_connection = Arc::new(
            api.new_peer_connection(config)
                .await
                .map_err(|e| CoreError::NetworkError(format!("建立 PeerConnection 失敗: {}", e)))?
        );

        // 綁定連線狀態改變監聽
        peer_connection.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
            println!("WebRTC 連線狀態變更: {:?}", state);
            Box::pin(async {})
        }));

        Ok(Self { peer_connection })
    }

    /// 加入本機螢幕擷取的視訊串流軌道
    pub async fn add_video_track(&self) -> Result<Arc<TrackLocalStaticSample>, CoreError> {
        let video_track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: "video/H264".to_owned(),
                ..Default::default()
            },
            "screen".to_owned(),
            "webrtc-rs".to_owned(),
        ));

        self.peer_connection
            .add_track(Arc::clone(&video_track) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(|e| CoreError::NetworkError(format!("無法加入視訊軌道: {}", e)))?;

        Ok(video_track)
    }

    /// 加入第二條「感知優先 (Foveated)」視訊串流軌道，用於游標周圍的高畫質疊加
    pub async fn add_foveated_video_track(&self) -> Result<Arc<TrackLocalStaticSample>, CoreError> {
        let foveated_track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: "video/H264".to_owned(),
                ..Default::default()
            },
            "foveated".to_owned(),
            "webrtc-rs".to_owned(),
        ));

        self.peer_connection
            .add_track(Arc::clone(&foveated_track) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(|e| CoreError::NetworkError(format!("無法加入 Foveated 視訊軌道: {}", e)))?;

        Ok(foveated_track)
    }

    /// 加入本機系統音訊擷取的音訊串流軌道
    pub async fn add_audio_track(&self) -> Result<Arc<TrackLocalStaticSample>, CoreError> {
        let audio_track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: "audio/opus".to_owned(),
                ..Default::default()
            },
            "audio".to_owned(),
            "webrtc-rs".to_owned(),
        ));

        self.peer_connection
            .add_track(Arc::clone(&audio_track) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(|e| CoreError::NetworkError(format!("無法加入音訊軌道: {}", e)))?;

        Ok(audio_track)
    }

    /// 建立高優先權的滑鼠與鍵盤控制輸入通道 (可靠傳輸)
    pub async fn setup_input_channel(&self) -> Result<Arc<RTCDataChannel>, CoreError> {
        let init = RTCDataChannelInit {
            ordered: Some(true),
            max_retransmits: None, // 允許無限重傳，保證按鍵不遺失
            ..Default::default()
        };

        let data_channel = self.peer_connection
            .create_data_channel("input-control", Some(init))
            .await
            .map_err(|e| CoreError::NetworkError(format!("無法建立輸入控制通道: {}", e)))?;

        // 反重放序號計數器
        let last_seq = Arc::new(AtomicU32::new(0));

        data_channel.on_close(Box::new(move || {
            Box::pin(async move {
                println!("[input-control] DataChannel closed, resetting input state to prevent stuck keys.");
                if let Err(e) = crate::input::InputEvent::ResetState.simulate() {
                    eprintln!("[input-control] ResetState failed on close: {}", e);
                }
            })
        }));

        let _dc = Arc::clone(&data_channel);
        data_channel.on_message(Box::new(move |msg| {
            let data = msg.data.to_vec();
            let last_seq = Arc::clone(&last_seq);
            Box::pin(async move {
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
                                eprintln!("[security input-control] packet rejected: {}", e);
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!("[input-control] deserialize failed: {:?}", err);
                    }
                }
            })
        }));

        Ok(data_channel)
    }

    /// 建立非可靠、不重傳、不保證順序的輸入通道 (用於滑鼠移動等高頻且可遺失的數據)
    pub async fn setup_unreliable_input_channel(&self) -> Result<Arc<RTCDataChannel>, CoreError> {
        let init = RTCDataChannelInit {
            ordered: Some(false),
            max_retransmits: Some(0), // 不重傳
            ..Default::default()
        };

        let data_channel = self.peer_connection
            .create_data_channel("input-unreliable", Some(init))
            .await
            .map_err(|e| CoreError::NetworkError(format!("無法建立非可靠輸入通道: {}", e)))?;

        let last_seq = Arc::new(AtomicU32::new(0));

        let _dc = Arc::clone(&data_channel);
        data_channel.on_message(Box::new(move |msg| {
            let data = msg.data.to_vec();
            let last_seq = Arc::clone(&last_seq);
            Box::pin(async move {
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
                                eprintln!("[security input-unreliable] packet rejected: {}", e);
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!("[input-unreliable] deserialize failed: {:?}", err);
                    }
                }
            })
        }));

        Ok(data_channel)
    }

    /// 建立系統控制通道，用於傳送與接收螢幕切換等狀態設定 (可靠傳輸)
    pub async fn setup_system_control_channel(
        &self,
        monitor_tx: tokio::sync::watch::Sender<usize>,
    ) -> Result<Arc<RTCDataChannel>, CoreError> {
        let init = RTCDataChannelInit {
            ordered: Some(true),
            ..Default::default()
        };

        let data_channel = self.peer_connection
            .create_data_channel("system-control", Some(init))
            .await
            .map_err(|e| CoreError::NetworkError(format!("無法建立 system-control 通道: {}", e)))?;

        let dc_clone_for_open = Arc::clone(&data_channel);
        
        data_channel.on_open(Box::new(move || {
            let dc = Arc::clone(&dc_clone_for_open);
            Box::pin(async move {
                // [FIX] xcap::Monitor::all() 呼叫了底層 macOS API (NSScreen/CGDisplay)
                // 若在 WebRTC 的背景執行緒中呼叫，會直接導致 WindowServer 瞬間死鎖 (Mac 死機)
                /*
                let monitors = xcap::Monitor::all().unwrap_or_default();
                let mut monitor_list = Vec::new();
                for (i, m) in monitors.iter().enumerate() {
                    monitor_list.push(serde_json::json!({
                        "id": m.id().unwrap_or(0),
                        "name": m.name().unwrap_or_else(|_| format!("Display {}", i)),
                        "is_primary": m.is_primary().unwrap_or(false),
                    }));
                }
                let msg = serde_json::json!({
                    "type": "monitor_list",
                    "monitors": monitor_list,
                    "current": 0
                });
                if let Ok(json_str) = serde_json::to_string(&msg) {
                    let _ = dc.send_text(json_str).await;
                }
                */
                println!("[SystemControl] DataChannel opened (Monitor detection temporarily disabled to prevent crash)");
            })
        }));

        data_channel.on_message(Box::new(move |msg| {
            let monitor_tx = monitor_tx.clone();
            let data = msg.data.to_vec();
            Box::pin(async move {
                if let Ok(text) = String::from_utf8(data) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        if json["type"] == "switch_monitor" {
                            if let Some(index) = json["index"].as_u64() {
                                let _ = monitor_tx.send(index as usize);
                            }
                        }
                    }
                }
            })
        }));

        Ok(data_channel)
    }



    /// 獲取原生 PeerConnection 引用，以便與信令搓合模組進行 SDP 協商
    pub fn get_peer_connection(&self) -> Arc<RTCPeerConnection> {
        Arc::clone(&self.peer_connection)
    }
}
