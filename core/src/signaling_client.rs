use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as WsMessage};
use crate::engine::{CoreEngine, EngineEvent};

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
pub enum IncomingMessage {
    #[serde(rename = "offer")]
    Offer {
        source: String,
        pin: String,
        sdp: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    },
    #[serde(rename = "answer")]
    Answer {
        source: String,
        sdp: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    },
    #[serde(rename = "ice")]
    Ice {
        source: String,
        candidate: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "custom_request_logs")]
    CustomRequestLogs { source: String, target: String },
    #[serde(rename = "login_required")]
    LoginRequired {
        source: String,
        reason: String,
        platform: Option<String>,
    },
    #[serde(rename = "login_input")]
    LoginInput {
        source: String,
        username: Option<String>,
        #[serde(rename = "authPassword")]
        auth_password: String,
        #[serde(rename = "loginPassword")]
        login_password: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    },
    #[serde(rename = "login_result")]
    LoginResult {
        source: String,
        success: bool,
        message: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    },
}

impl CoreEngine {
    pub async fn start_signaling_task(
        self: &Arc<Self>,
        my_id: String,
        mut ws_rx: mpsc::Receiver<String>,
        mut abort_rx: tokio::sync::oneshot::Receiver<()>,
    ) {
        let ws_url = "wss://twosyn-signaling.onrender.com/ws";
        let active_ws_sender: Arc<Mutex<Option<mpsc::Sender<WsMessage>>>> = Arc::new(Mutex::new(None));

        let active_ws_sender_clone = Arc::clone(&active_ws_sender);
        let mut _forward_task = tokio::spawn(async move {
            while let Some(msg_str) = ws_rx.recv().await {
                let tx_opt = active_ws_sender_clone.lock().await.clone();
                if let Some(tx) = tx_opt {
                    let _ = tx.send(WsMessage::Text(msg_str.into())).await;
                }
            }
        });

        // 指數退避重連：5 → 10 → 20 → 40 → 60 秒（連線成功後重置）
        let mut retry_delay_secs: u64 = 5;

        loop {
            if !matches!(
                abort_rx.try_recv(),
                Err(tokio::sync::oneshot::error::TryRecvError::Empty)
            ) {
                println!("[Rust Signaling] 退出信令任務");
                break;
            }

            self.emit(EngineEvent::SignalingLog(format!("[Rust] 嘗試連線到信令伺服器: {}", ws_url)));
            self.emit(EngineEvent::SignalingStatus("connecting".to_string()));

            let url_parsed = match url::Url::parse(ws_url) {
                Ok(u) => u,
                Err(e) => {
                    self.emit(EngineEvent::SignalingLog(format!("[Rust Error] URL 解析錯誤: {}", e)));
                    tokio::time::sleep(std::time::Duration::from_secs(retry_delay_secs)).await;
                    retry_delay_secs = (retry_delay_secs * 2).min(60);
                    continue;
                }
            };

            let conn_res = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                connect_async(url_parsed),
            ).await;
            let (ws_stream, _) = match conn_res {
                Ok(Ok(val)) => val,
                Ok(Err(e)) => {
                    self.emit(EngineEvent::SignalingLog(format!("[Rust Error] 連線信令伺服器失敗: {}, {}秒後重試", e, retry_delay_secs)));
                    self.emit(EngineEvent::SignalingStatus("offline".to_string()));
                    tokio::time::sleep(std::time::Duration::from_secs(retry_delay_secs)).await;
                    retry_delay_secs = (retry_delay_secs * 2).min(60);
                    continue;
                }
                Err(_) => {
                    // connect_async 超過 15 秒無回應（Render 冷啟動掛起）
                    self.emit(EngineEvent::SignalingLog(format!("[Rust Error] 連線信令伺服器逾時 (15s)，{}秒後重試", retry_delay_secs)));
                    self.emit(EngineEvent::SignalingStatus("offline".to_string()));
                    tokio::time::sleep(std::time::Duration::from_secs(retry_delay_secs)).await;
                    retry_delay_secs = (retry_delay_secs * 2).min(60);
                    continue;
                }
            };

            // 連線成功，重置退避計時器
            retry_delay_secs = 5;

            self.emit(EngineEvent::SignalingLog("[Rust] 已成功建立 WebSocket 連線，正在登入...".to_string()));

            let (mut ws_write, mut ws_read) = ws_stream.split();
            let login_msg = serde_json::json!({ "type": "login", "id": &my_id });
            if let Err(e) = ws_write.send(WsMessage::Text(login_msg.to_string().into())).await {
                self.emit(EngineEvent::SignalingLog(format!("[Rust Error] 發送登入封包失敗: {}", e)));
                self.emit(EngineEvent::SignalingStatus("offline".to_string()));
                tokio::time::sleep(std::time::Duration::from_secs(retry_delay_secs)).await;
                retry_delay_secs = (retry_delay_secs * 2).min(60);
                continue;
            }

            let (tx, mut rx) = mpsc::channel::<WsMessage>(32);
            *active_ws_sender.lock().await = Some(tx);
            self.emit(EngineEvent::SignalingStatus("online".to_string()));
            self.emit(EngineEvent::SignalingLog("[Rust] WebSocket 已登入並在背景執行".to_string()));

            let engine_inner = Arc::clone(self);
            let mut read_task = tokio::spawn(async move {
                while let Some(msg_res) = ws_read.next().await {
                    match msg_res {
                        Ok(msg) => {
                            if let WsMessage::Text(text) = msg {
                                if let Ok(parsed) = serde_json::from_str::<IncomingMessage>(text.as_str()) {
                                    match parsed {
                                        IncomingMessage::Offer { source, pin, sdp, session_id } => {
                                            engine_inner.emit(EngineEvent::IncomingOffer(source, pin, sdp, session_id));
                                        }
                                        IncomingMessage::Answer { source, sdp, session_id } => {
                                            engine_inner.emit(EngineEvent::IncomingAnswer(source, sdp, session_id));
                                        }
                                        IncomingMessage::Ice { source, candidate, session_id } => {
                                            engine_inner.emit(EngineEvent::IncomingIce(source, candidate, session_id));
                                        }
                                        IncomingMessage::Error { message } => {
                                            engine_inner.emit(EngineEvent::SignalingLog(format!("[Rust Signaling Server Error] {}", message)));
                                            engine_inner.emit(EngineEvent::SignalingError(message));
                                        }
                                        IncomingMessage::CustomRequestLogs { source, target } => {
                                            engine_inner.emit(EngineEvent::CustomRequestLogs { source, target });
                                        }
                                        IncomingMessage::LoginRequired { source, reason, platform } => {
                                            engine_inner.emit(EngineEvent::LoginRequired { source, reason, platform });
                                        }
                                        IncomingMessage::LoginInput { source, username, auth_password, login_password, session_id } => {
                                            engine_inner.emit(EngineEvent::LoginInput { source, username, auth_password, login_password, session_id });
                                        }
                                        IncomingMessage::LoginResult { source, success, message, session_id } => {
                                            engine_inner.emit(EngineEvent::LoginResult { source, success, message, session_id });
                                        }
                                        IncomingMessage::Pong => {}
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            engine_inner.emit(EngineEvent::SignalingLog(format!("[Rust WS Error] {}", e)));
                            break;
                        }
                    }
                }
            });

            let mut write_task = tokio::spawn(async move {
                let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(30));
                loop {
                    tokio::select! {
                        _ = heartbeat.tick() => {
                            let ping_msg = serde_json::json!({ "type": "ping" });
                            if ws_write.send(WsMessage::Text(ping_msg.to_string().into())).await.is_err() {
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

            tokio::select! {
                _ = &mut read_task => {
                    self.emit(EngineEvent::SignalingLog("[Rust Signaling] 讀取任務結束，連線中斷".to_string()));
                    write_task.abort();
                }
                _ = &mut write_task => {
                    self.emit(EngineEvent::SignalingLog("[Rust Signaling] 寫入任務結束，連線中斷".to_string()));
                    read_task.abort();
                }
                _ = &mut abort_rx => {
                    self.emit(EngineEvent::SignalingLog("[Rust Signaling] 收到中止信號，主動結束連線".to_string()));
                    write_task.abort();
                    read_task.abort();
                    break;
                }
            }

            *active_ws_sender.lock().await = None;
            self.emit(EngineEvent::SignalingStatus("offline".to_string()));
            self.emit(EngineEvent::SignalingLog(format!("[Rust Signaling] 連線已斷開，{}秒後嘗試重新連線...", retry_delay_secs)));
            tokio::time::sleep(std::time::Duration::from_secs(retry_delay_secs)).await;
            retry_delay_secs = (retry_delay_secs * 2).min(60);
        }
    }
}
