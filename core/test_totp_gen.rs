use totp_rs::{Algorithm, TOTP};
use std::time::{SystemTime, UNIX_EPOCH};

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
    
    let token = totp.generate_current().unwrap();
    println!("Token: {}", token);
}
