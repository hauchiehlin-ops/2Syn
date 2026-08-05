#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(serde::Deserialize)]
pub struct TurnServerConfig {
    pub urls: TurnUrls,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub credential: Option<String>,
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(serde::Deserialize)]
#[serde(untagged)]
pub enum TurnUrls {
    Single(String),
    Multiple(Vec<String>),
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn turn_configs_to_ice_servers(
    configs: Vec<TurnServerConfig>,
) -> Vec<webrtc::ice_transport::ice_server::RTCIceServer> {
    use webrtc::ice_transport::ice_credential_type::RTCIceCredentialType;
    configs
        .into_iter()
        .map(|c| webrtc::ice_transport::ice_server::RTCIceServer {
            urls: match c.urls {
                TurnUrls::Single(s) => vec![s],
                TurnUrls::Multiple(v) => v,
            },
            username: c.username.unwrap_or_default(),
            credential: c.credential.unwrap_or_default(),
            credential_type: RTCIceCredentialType::Password,
            ..Default::default()
        })
        .collect()
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn default_turn_servers() -> Vec<webrtc::ice_transport::ice_server::RTCIceServer> {
    use webrtc::ice_transport::ice_credential_type::RTCIceCredentialType;
    vec![
        // openrelay：同時提供 UDP/TCP/TURNS(TLS port 443)，TLS 端口可穿透嚴格防火牆
        webrtc::ice_transport::ice_server::RTCIceServer {
            urls: vec![
                "turn:openrelay.metered.ca:80".to_string(),
                "turn:openrelay.metered.ca:80?transport=tcp".to_string(),
                "turn:openrelay.metered.ca:443?transport=tcp".to_string(),
                "turns:openrelay.metered.ca:443?transport=tcp".to_string(),
            ],
            username: "openrelayproject".to_string(),
            credential: "openrelayproject".to_string(),
            credential_type: RTCIceCredentialType::Password,
            ..Default::default()
        },
        // freestun：免費備援 TURN（username/credential 固定為 "free"）
        webrtc::ice_transport::ice_server::RTCIceServer {
            urls: vec!["turn:freestun.net:3479".to_string()],
            username: "free".to_string(),
            credential: "free".to_string(),
            credential_type: RTCIceCredentialType::Password,
            ..Default::default()
        },
    ]
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub fn resolve_ice_servers(
    turn_servers: Option<Vec<TurnServerConfig>>,
) -> Vec<webrtc::ice_transport::ice_server::RTCIceServer> {
    match turn_servers {
        Some(list) if !list.is_empty() => turn_configs_to_ice_servers(list),
        _ => default_turn_servers(),
    }
}
