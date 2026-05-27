#[cfg(not(target_os = "ios"))]
pub mod connection;
#[cfg(not(target_os = "ios"))]
pub mod codec;
pub mod security;
pub mod input;
pub mod idd;
#[cfg(not(target_os = "ios"))]
pub mod file_transfer;


/// 系統核心通用錯誤定義
#[derive(Debug)]
pub enum CoreError {
    CryptoError(String),
    NetworkError(String),
    HardwareCodecError(String),
    StorageError(String),
    SystemError(String),
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CoreError::CryptoError(msg) => write!(f, "加密錯誤: {}", msg),
            CoreError::NetworkError(msg) => write!(f, "網路連線錯誤: {}", msg),
            CoreError::HardwareCodecError(msg) => write!(f, "硬體編解碼錯誤: {}", msg),
            CoreError::StorageError(msg) => write!(f, "安全儲存錯誤: {}", msg),
            CoreError::SystemError(msg) => write!(f, "系統層級錯誤: {}", msg),
        }
    }
}

impl std::error::Error for CoreError {}
#[cfg(not(target_os = "ios"))]
pub mod video;
