use webrtc::peer_connection::RTCPeerConnection;
use webrtc::stats::StatsReportType;
use std::sync::Arc;

pub async fn test_stats(pc: Arc<RTCPeerConnection>) {
    let stats = pc.get_stats().await;
    for (id, stat) in stats.iter() {
        if let StatsReportType::RemoteInboundRtp(rtp_stats) = &stat.stats_type {
            let rtt: f64 = rtp_stats.round_trip_time;
            let loss: f64 = rtp_stats.fraction_lost;
        }
    }
}
