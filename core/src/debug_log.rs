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
    let line = format!("[{}] [{}] {}", timestamp, module, message);

    // 同時印出到終端機（release 版 GUI subsystem 在 Windows 上沒有主控台，
    // stderr 沒有任何人看得到——這也是本函式名為 log_to_file 卻長年只印
    // stderr、從未真正落檔的原因：安裝版使用者遇到問題時完全查無日誌）
    eprintln!("{}", line);

    // 落檔到使用者主目錄，讓已安裝的 release 版也能事後追查
    // （Windows 上 HOME 不一定存在，需 fallback 到 USERPROFILE）
    let home_dir = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home_dir) = home_dir {
        let _guard = LOG_MUTEX.lock();
        let mut path = std::path::PathBuf::from(home_dir);
        path.push("2syn-debug.log");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(file, "{}", line);
        }
    }
}

#[macro_export]
macro_rules! debug_log {
    ($module:expr, $($arg:tt)*) => {
        $crate::debug_log::log_to_file($module, &format!($($arg)*));
    };
}
