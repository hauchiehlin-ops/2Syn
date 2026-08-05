use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};
use crate::connection::ConnectionManager;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
use crate::file_transfer::FileTransferState;

/// EngineEvent: Core events emitted by the engine to be consumed by Tauri or Daemon.
#[derive(Debug, Clone)]
pub enum EngineEvent {

    SignalingLog(String),
    SignalingStatus(String),
    IncomingOffer(String, String, String, Option<String>),
    IncomingAnswer(String, String, Option<String>),
    IncomingIce(String, String, Option<String>),
    SignalingConnected,
    SignalingDisconnected,
    PeerConnected(String),
    PeerDisconnected(String),
    SignalingStatusUpdate(String),
    PinUpdated(String),
    IncomingFileRequest { name: String, size: u64 },
    FileTransferProgress { name: String, progress: f32 },
    FileTransferComplete { name: String },
    IceCandidate(String),
    WebRtcStateChange(String),
    MonitorList(String),
    VideoStatus(String),
    SignalingError(String),
    CustomRequestLogs { source: String, target: String },
}

/// CoreEngine encapsulates the entire connection, WebRTC, and signaling state.
/// It replaces the `AppState` previously located in `desktop/src-tauri/src/lib.rs`.
pub struct CoreEngine {
    pub connection_manager: Arc<ConnectionManager>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub default_download_dir: Option<std::path::PathBuf>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub active_pc: Mutex<Option<Arc<webrtc::peer_connection::RTCPeerConnection>>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub active_file_channel: Mutex<Option<Arc<webrtc::data_channel::RTCDataChannel>>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub active_file_control_channel: Mutex<Option<Arc<webrtc::data_channel::RTCDataChannel>>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub active_file_data_channels: Mutex<Vec<Arc<webrtc::data_channel::RTCDataChannel>>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub file_receive_state: Mutex<Option<Arc<Mutex<FileTransferState>>>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub file_resume_offsets: Mutex<std::collections::HashMap<String, u64>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub file_complete_confirmations: Mutex<std::collections::HashSet<String>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub active_file_send_ids: Mutex<std::collections::HashSet<String>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub file_cancelled_transfers: Mutex<std::collections::HashSet<String>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub signaling_tx: Mutex<Option<mpsc::Sender<String>>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub current_pin: Arc<RwLock<String>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub current_remote_id: Arc<RwLock<String>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub active_session_id: Arc<RwLock<String>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub signaling_abort: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub has_active_webrtc: Arc<std::sync::atomic::AtomicBool>,

    /// Event emitter used to push engine state changes out to the host application (Tauri/Daemon)
    pub event_tx: broadcast::Sender<EngineEvent>,
}

impl Default for CoreEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CoreEngine {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(512);
        
        Self {
            connection_manager: Arc::new(ConnectionManager::new()),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            default_download_dir: dirs::download_dir(),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            active_pc: Mutex::new(None),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            active_file_channel: Mutex::new(None),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            active_file_control_channel: Mutex::new(None),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            active_file_data_channels: Mutex::new(Vec::new()),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            file_receive_state: Mutex::new(None),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            file_resume_offsets: Mutex::new(std::collections::HashMap::new()),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            file_complete_confirmations: Mutex::new(std::collections::HashSet::new()),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            active_file_send_ids: Mutex::new(std::collections::HashSet::new()),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            file_cancelled_transfers: Mutex::new(std::collections::HashSet::new()),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            signaling_tx: Mutex::new(None),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            current_pin: Arc::new(RwLock::new("------".to_string())),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            current_remote_id: Arc::new(RwLock::new(String::new())),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            active_session_id: Arc::new(RwLock::new(String::new())),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            signaling_abort: Mutex::new(None),
            
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            has_active_webrtc: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            
            event_tx,
        }
    }

    /// Helper to emit an event
    pub fn emit(&self, event: EngineEvent) {
        let _ = self.event_tx.send(event);
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<EngineEvent> {
        self.event_tx.subscribe()
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub async fn add_ice_candidate(&self, candidate: String) -> Result<(), String> {
        let pc_lock = self.active_pc.lock().await;
        if let Some(pc) = pc_lock.as_ref() {
            if let Ok(init) = serde_json::from_str::<webrtc::ice_transport::ice_candidate::RTCIceCandidateInit>(&candidate) {
                pc.add_ice_candidate(init).await.map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
        Err("No active peer connection or invalid candidate".to_string())
    }
}
