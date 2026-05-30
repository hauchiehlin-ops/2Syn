use tokio::net::UdpSocket;

pub async fn wake_on_lan(mac_str: &str) -> Result<(), String> {
    // 移除常見的分隔符號 (冒號、連字號)
    let cleaned_mac: String = mac_str.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    
    if cleaned_mac.len() != 12 {
        return Err("無效的 MAC 地址長度".to_string());
    }

    let mut mac_bytes = [0u8; 6];
    for i in 0..6 {
        mac_bytes[i] = u8::from_str_radix(&cleaned_mac[(i * 2)..(i * 2 + 2)], 16)
            .map_err(|_| "無法解析 MAC 地址字元".to_string())?;
    }

    // 建構 Magic Packet
    // Magic Packet 的格式為： 6 bytes 的 0xFF 加上 16 次 MAC 地址 (6 bytes)，共 102 bytes。
    let mut magic_packet = vec![0xFF; 6];
    for _ in 0..16 {
        magic_packet.extend_from_slice(&mac_bytes);
    }

    // 使用 UdpSocket 廣播封包
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("無法綁定本地 UDP 埠: {}", e))?;
    
    socket.set_broadcast(true)
        .map_err(|e| format!("無法開啟 UDP 廣播模式: {}", e))?;

    // WoL 預設使用埠 9 或 7 進行廣播
    socket.send_to(&magic_packet, "255.255.255.255:9")
        .await
        .map_err(|e| format!("無法發送 Magic Packet: {}", e))?;

    Ok(())
}

/// 取得本機的 MAC 地址
pub fn get_local_mac_address() -> Result<String, String> {
    match mac_address::get_mac_address() {
        Ok(Some(ma)) => Ok(ma.to_string().to_uppercase()),
        Ok(None) => Err("無法找到 MAC 地址".to_string()),
        Err(e) => Err(format!("取得 MAC 地址失敗: {}", e)),
    }
}
