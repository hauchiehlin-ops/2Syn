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
use webrtc::ice_transport::ice_credential_type::RTCIceCredentialType;
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
    pub file_transfer_enabled: bool,
}

impl Default for QualityConfig {
    fn default() -> Self {
        Self {
            target_fps: 144,
            color_format: ColorFormat::Yuv444,
            bitrate_limit_kbps: 50_000, // 預設 50 Mbps
            file_transfer_enabled: true,
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
            || new_config.file_transfer_enabled != current_c.file_transfer_enabled
        {
            *current_c = new_config.clone();
            let _ = self.config_tx.send(new_config);
        }
    }

    /// 動態降級決策樹核心演算法
    fn decide_quality(&self, metrics: &NetworkMetrics) -> QualityConfig {
        let mut config = QualityConfig::default();

        // 1. 判斷連線媒介是否為 Relay
        if metrics.connection_type == ConnectionType::Relay {
            config.target_fps = 60;
            config.color_format = ColorFormat::Yuv420;
            config.bitrate_limit_kbps = 5000;
            config.file_transfer_enabled = false;
            return config;
        }

        // 2. 基於網路延遲 (RTT) 與丟包率的動態降級 (P2P 狀態下)
        if metrics.rtt_ms > 150 || metrics.packet_loss_rate > 0.08 {
            config.target_fps = 30;
            config.color_format = ColorFormat::Yuv420;
            config.bitrate_limit_kbps = 2000;
            config.file_transfer_enabled = false;
        } else if metrics.rtt_ms > 60 || metrics.packet_loss_rate > 0.03 {
            config.target_fps = 60;
            config.color_format = ColorFormat::Yuv420;
            config.bitrate_limit_kbps = 8000;
            config.file_transfer_enabled = true;
        } else if metrics.rtt_ms > 30 || metrics.packet_loss_rate > 0.01 {
            config.target_fps = 90;
            config.color_format = ColorFormat::Yuv444;
            config.bitrate_limit_kbps = 20000;
            config.file_transfer_enabled = true;
        } else {
            config.target_fps = 144;
            config.color_format = ColorFormat::Yuv444;
            config.bitrate_limit_kbps = 50000;
            config.file_transfer_enabled = true;
        }

        config
    }

    pub async fn get_current_config(&self) -> QualityConfig {
        self.current_config.lock().await.clone()
    }

    pub async fn get_current_metrics(&self) -> NetworkMetrics {
        self.current_metrics.lock().await.clone()
    }

    pub async fn start_monitor_loop(manager: Arc<Self>) {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            
            let mock_metrics = {
                let current_m = manager.current_metrics.lock().await;
                NetworkMetrics {
                    rtt_ms: current_m.rtt_ms,
                    packet_loss_rate: current_m.packet_loss_rate,
                    connection_type: current_m.connection_type,
                }
            };
            
            manager.update_metrics(mock_metrics).await;
        }
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

        // 高可用性 STUN 備援清單
        let ice_servers = vec![
            RTCIceServer {
                urls: vec![
                    "stun:stun.l.google.com:19302".to_string(),
                    "stun:stun1.l.google.com:19302".to_string(),
                    "stun:stun.cloudflare.com:3478".to_string(), // Cloudflare 作為全球備援
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

    /// 建立極低延遲高優先權的滑鼠與鍵盤控制輸入通道 (Data Channel)
    pub async fn setup_input_channel(&self) -> Result<Arc<RTCDataChannel>, CoreError> {
        // 設定 Data Channel 為不可靠、免重傳以求極致低延遲
        let init = RTCDataChannelInit {
            ordered: Some(true),
            max_retransmits: Some(0), // 不重傳
            ..Default::default()
        };

        let data_channel = self.peer_connection
            .create_data_channel("input-control", Some(init))
            .await
            .map_err(|e| CoreError::NetworkError(format!("無法建立輸入控制通道: {}", e)))?;

        // 反重放序號計數器（原子操作，執行緒安全）
        let last_seq = Arc::new(AtomicU32::new(0));

        // 註冊資料通道接收回呼
        let _dc = Arc::clone(&data_channel);
        data_channel.on_message(Box::new(move |msg| {
            let data = msg.data.to_vec();
            let last_seq = Arc::clone(&last_seq);
            Box::pin(async move {
                // 以 SecureInputPacket 進行反序列化，強制驗證序號遞增與時間戳記時效（抵禦重放攻擊）
                match SecureInputPacket::deserialize(&data) {
                    Ok(packet) => {
                        let prev_seq = last_seq.load(Ordering::SeqCst);
                        match packet.verify(prev_seq) {
                            Ok(()) => {
                                // 更新已知最新序號
                                last_seq.store(packet.sequence_number, Ordering::SeqCst);
                                if let Err(e) = packet.event.simulate() {
                                    eprintln!("[input] simulate failed: {}", e);
                                }
                            }
                            Err(e) => {
                                eprintln!("[security] packet rejected: {}", e);
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!("[input] deserialize failed: {:?}", err);
                    }
                }
            })
        }));

        Ok(data_channel)
    }

    /// 建立高可靠性的檔案傳輸通道 (Data Channel)
    pub async fn setup_file_channel(&self) -> Result<Arc<RTCDataChannel>, CoreError> {
        // 設定 Data Channel 為可靠模式（預設）以確保檔案不遺失
        let init = RTCDataChannelInit {
            ordered: Some(true),
            max_retransmits: None, // 允許無限重傳（可靠傳輸）
            ..Default::default()
        };

        let data_channel = self.peer_connection
            .create_data_channel("file-transfer", Some(init))
            .await
            .map_err(|e| CoreError::NetworkError(format!("無法建立檔案傳輸通道: {}", e)))?;

        // 註冊資料通道接收回呼 (在此可將收到的 chunk 送入 ChunkReassembler)
        // 實務上應搭配一個 tokio mpsc channel 將 chunk 送給後台 worker 處理
        let _dc = Arc::clone(&data_channel);
        data_channel.on_message(Box::new(move |msg| {
            let _data = msg.data.to_vec();
            // TODO: 送入 ChunkReassembler
            Box::pin(async move {})
        }));

        Ok(data_channel)
    }

    /// 獲取原生 PeerConnection 引用，以便與信令搓合模組進行 SDP 協商
    pub fn get_peer_connection(&self) -> Arc<RTCPeerConnection> {
        Arc::clone(&self.peer_connection)
    }
}
