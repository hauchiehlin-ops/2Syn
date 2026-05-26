use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::RwLock;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

// 伺服器 Ed25519 PKCS8 私鑰 (與用戶端公鑰對應)
pub const SERVER_PRIVATE_KEY: [u8; 83] = [
    48, 81, 2, 1, 1, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32, 
    132, 131, 233, 93, 197, 14, 30, 176, 204, 22, 97, 240, 194, 158, 
    92, 12, 147, 218, 208, 192, 68, 0, 113, 123, 97, 160, 0, 71, 
    179, 105, 174, 183, 129, 33, 0, 240, 45, 123, 170, 114, 25, 87, 
    250, 186, 155, 245, 112, 101, 188, 142, 80, 96, 138, 206, 138, 232, 
    105, 150, 107, 23, 249, 156, 78, 57, 241, 58, 167
];

struct LicenseInfo {
    activated_hwids: Vec<String>,
    last_deactivated_at: Option<SystemTime>,
}

struct ServerState {
    licenses: RwLock<HashMap<String, LicenseInfo>>,
}

#[derive(Deserialize)]
struct ActivateRequest {
    license_key: String,
    hwid: String,
}

#[derive(Serialize)]
struct ActivateResponse {
    success: bool,
    ticket: Option<String>,
    message: String,
}

#[derive(Deserialize)]
struct DeactivateRequest {
    license_key: String,
    hwid: String,
}

#[derive(Serialize)]
struct DeactivateResponse {
    success: bool,
    message: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .init();

    // 初始化模擬資料庫與預置買斷金鑰
    let mut licenses = HashMap::new();
    licenses.insert(
        "BUYOUT-KEY-12345".to_string(),
        LicenseInfo {
            activated_hwids: Vec::new(),
            last_deactivated_at: None,
        },
    );

    let state = Arc::new(ServerState {
        licenses: RwLock::new(licenses),
    });

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/activate", post(activate_handler))
        .route("/deactivate", post(deactivate_handler))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    println!("2syn 信令與授權驗證伺服器已啟動: http://{}", addr);
    
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    println!("新客戶端已連線");
    
    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Text(text) => {
                println!("收到信令 SDP/ICE: {}", text);
                if socket.send(Message::Text(format!("Echo back: {}", text))).await.is_err() {
                    break;
                }
            }
            Message::Close(_) => {
                println!("客戶端中斷連線");
                break;
            }
            _ => {}
        }
    }
}

// 簽署憑證核心邏輯
fn sign_activation_ticket(license_key: &str, hwid: &str, timestamp: u64, private_key_der: &[u8]) -> Result<String, String> {
    let key_pair = ring::signature::Ed25519KeyPair::from_pkcs8(private_key_der)
        .map_err(|e| format!("伺服器私鑰載入失敗: {}", e))?;
    
    // 憑證格式: LicenseKey|HWID|Timestamp
    let payload = format!("{}|{}|{}", license_key, hwid, timestamp);
    let signature = key_pair.sign(payload.as_bytes());
    let signature_hex = hex::encode(signature.as_ref());
    
    Ok(format!("{}.{}", payload, signature_hex))
}

// 啟用裝置端點
async fn activate_handler(
    State(state): State<Arc<ServerState>>,
    Json(payload): Json<ActivateRequest>,
) -> impl IntoResponse {
    let mut licenses = state.licenses.write().await;
    let license_key = payload.license_key.trim();
    let hwid = payload.hwid.trim();
    
    if license_key.is_empty() || hwid.is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(ActivateResponse {
                success: false,
                ticket: None,
                message: "err_license_empty".to_string(),
            }),
        );
    }
    
    // 為了方便測試，不存在的金鑰也允許在 PoC 中動態新增 (預設以買斷格式處理)
    let info = licenses.entry(license_key.to_string()).or_insert_with(|| LicenseInfo {
        activated_hwids: Vec::new(),
        last_deactivated_at: None,
    });
    
    // 若本裝置已啟用，直接簽發當前時間戳憑證回傳
    if info.activated_hwids.contains(&hwid.to_string()) {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
            
        match sign_activation_ticket(license_key, hwid, timestamp, &SERVER_PRIVATE_KEY) {
            Ok(ticket) => {
                return (
                    axum::http::StatusCode::OK,
                    Json(ActivateResponse {
                        success: true,
                        ticket: Some(ticket),
                        message: "activate_success_already".to_string(),
                    }),
                );
            }
            Err(e) => {
                return (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ActivateResponse {
                        success: false,
                        ticket: None,
                        message: format!("err_ticket_signing_failed|{}", e),
                    }),
                );
            }
        }
    }
    
    // 限制最多 5 台設備
    if info.activated_hwids.len() >= 5 {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(ActivateResponse {
                success: false,
                ticket: None,
                message: format!("err_limit_exceeded|{:?}", info.activated_hwids),
            }),
        );
    }
    
    // 新增啟用綁定
    info.activated_hwids.push(hwid.to_string());
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
        
    match sign_activation_ticket(license_key, hwid, timestamp, &SERVER_PRIVATE_KEY) {
        Ok(ticket) => {
            (
                axum::http::StatusCode::OK,
                Json(ActivateResponse {
                    success: true,
                    ticket: Some(ticket),
                    message: format!("activate_success|{}", info.activated_hwids.len()),
                }),
            )
        }
        Err(e) => {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(ActivateResponse {
                    success: false,
                    ticket: None,
                    message: format!("err_ticket_signing_failed|{}", e),
                }),
            )
        }
    }
}

// 解除啟用裝置端點
async fn deactivate_handler(
    State(state): State<Arc<ServerState>>,
    Json(payload): Json<DeactivateRequest>,
) -> impl IntoResponse {
    let mut licenses = state.licenses.write().await;
    let license_key = payload.license_key.trim();
    let hwid = payload.hwid.trim();
    
    if let Some(info) = licenses.get_mut(license_key) {
        // 為了 PoC 演示方便，防弊冷卻時間設為 10 秒 (生產環境實務上為 30 天)
        let now = SystemTime::now();
        if let Some(last_deact) = info.last_deactivated_at {
            if let Ok(duration) = now.duration_since(last_deact) {
                if duration.as_secs() < 10 {
                    return (
                        axum::http::StatusCode::BAD_REQUEST,
                        Json(DeactivateResponse {
                            success: false,
                            message: format!("err_cooldown_active|{}", 10 - duration.as_secs()),
                        }),
                    );
                }
            }
        }
        
        if let Some(pos) = info.activated_hwids.iter().position(|x| x == hwid) {
            info.activated_hwids.remove(pos);
            info.last_deactivated_at = Some(now);
            (
                axum::http::StatusCode::OK,
                Json(DeactivateResponse {
                    success: true,
                    message: format!("deactivate_success|{}", info.activated_hwids.len()),
                }),
            )
        } else {
            (
                axum::http::StatusCode::NOT_FOUND,
                Json(DeactivateResponse {
                    success: false,
                    message: "err_device_not_bound".to_string(),
                }),
            )
        }
    } else {
        (
            axum::http::StatusCode::NOT_FOUND,
            Json(DeactivateResponse {
                success: false,
                message: "err_invalid_license".to_string(),
            }),
        )
    }
}
