use totp_rs::{Algorithm, TOTP, Secret};
fn main() {
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        vec![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
        Some("Test".to_string()),
        "user".to_string(),
    ).unwrap();
    println!("QR: {}", totp.get_qr_base64().unwrap());
}
