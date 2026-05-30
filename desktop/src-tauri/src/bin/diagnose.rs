use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as WsMessage};
use url::Url;

#[tokio::main]
async fn main() {
    let ws_url = "wss://twosyn-signaling.onrender.com/ws";
    println!("=== 2syn 信令伺服器連線診斷工具 ===");
    println!("嘗試解析 URL: {}", ws_url);
    let url_parsed = match Url::parse(ws_url) {
        Ok(u) => {
            println!("URL 解析成功: {:?}", u);
            u
        }
        Err(e) => {
            eprintln!("URL 解析失敗: {}", e);
            return;
        }
    };

    println!("開始連線信令伺服器 ConnectAsync...");
    let conn_res = connect_async(url_parsed).await;
    match conn_res {
        Ok((ws_stream, response)) => {
            println!("連線成功！");
            println!("HTTP 握手響應狀態碼: {}", response.status());
            println!("HTTP 響應頭:");
            for (name, value) in response.headers() {
                println!("  {}: {:?}", name, value);
            }

            let (mut ws_write, mut ws_read) = ws_stream.split();

            let my_id = "test_diag_123";
            println!("發送登入封包，ID: {}", my_id);
            let login_msg = serde_json::json!({
                "type": "login",
                "id": my_id
            });

            if let Err(e) = ws_write.send(WsMessage::Text(login_msg.to_string())).await {
                eprintln!("發送登入封包失敗: {}", e);
                return;
            }
            println!("登入封包發送成功，等待 5 秒接收伺服器消息...");

            tokio::select! {
                res = ws_read.next() => {
                    match res {
                        Some(Ok(msg)) => {
                            println!("接收到伺服器訊息: {:?}", msg);
                        }
                        Some(Err(e)) => {
                            eprintln!("讀取伺服器訊息出錯: {}", e);
                        }
                        None => {
                            println!("伺服器關閉了連線。");
                        }
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {
                    println!("5 秒內未收到任何伺服器響應，連線正常。");
                }
            }
        }
        Err(e) => {
            eprintln!("連線失敗！");
            eprintln!("錯誤詳情 (Error Root Cause): {:?}", e);
            eprintln!("錯誤說明: {}", e);
        }
    }
}
