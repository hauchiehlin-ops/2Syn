use webrtc::ice_transport::ice_server::{RTCIceServer, RTCIceCredentialType};

fn main() {
    let server = RTCIceServer::default();
    println!("Default credential type: {:?}", server.credential_type);
}
