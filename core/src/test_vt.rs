use videotoolbox::CompressionSession;

fn test_vt(mut session: CompressionSession) {
    let _ = session.set_average_bitrate(1000 * 1000);
}
