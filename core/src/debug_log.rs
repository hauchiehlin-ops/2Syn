use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use lazy_static::lazy_static;

lazy_static! {
    static ref LOG_MUTEX: Mutex<()> = Mutex::new(());
}

pub fn log_to_file(module: &str, message: &str) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    
    // 同時印出到終端機
    eprintln!("[{}] [{}] {}", timestamp, module, message);
}

#[macro_export]
macro_rules! debug_log {
    ($module:expr, $($arg:tt)*) => {
        $crate::debug_log::log_to_file($module, &format!($($arg)*));
    };
}
