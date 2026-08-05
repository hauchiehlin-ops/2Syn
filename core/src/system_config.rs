use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use std::io::{Read, Write};
use log::{info, error};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SystemConfigData {
    pub hwid: Option<String>,
    pub hashed_password: Option<String>,
}

pub struct SystemConfig;

impl SystemConfig {
    #[cfg(target_os = "windows")]
    fn config_path() -> PathBuf {
        let program_data = std::env::var("PROGRAMDATA").unwrap_or_else(|_| "C:\\ProgramData".to_string());
        PathBuf::from(program_data).join("2syn").join("config.json")
    }

    #[cfg(target_os = "macos")]
    fn config_path() -> PathBuf {
        PathBuf::from("/Library/Application Support/2syn/config.json")
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    fn config_path() -> PathBuf {
        PathBuf::from("/etc/2syn/config.json")
    }

    pub fn read_config() -> SystemConfigData {
        let path = Self::config_path();
        if !path.exists() {
            return SystemConfigData::default();
        }
        
        match fs::File::open(&path) {
            Ok(mut file) => {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok() {
                    if let Ok(data) = serde_json::from_str(&content) {
                        return data;
                    }
                }
            }
            Err(e) => {
                error!("Failed to open system config {}: {}", path.display(), e);
            }
        }
        SystemConfigData::default()
    }

    pub fn write_config(data: &SystemConfigData) -> Result<(), String> {
        let path = Self::config_path();
        
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| format!("Failed to create config directory: {}", e))?;
                
                // On macOS, try to ensure /Library/Application Support/2syn is writable or at least created properly
                // This requires root when run, which is fine since installation is elevated.
            }
        }

        let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        
        let mut file = fs::File::create(&path).map_err(|e| format!("Failed to create config file: {}", e))?;
        file.write_all(content.as_bytes()).map_err(|e| format!("Failed to write config file: {}", e))?;
        
        info!("System configuration updated at {}", path.display());
        Ok(())
    }

    // Passwords should ideally be hashed before saving, but since they are used for Ed25519 or basic auth,
    // we can use a simple SHA256 hash to verify.
    pub fn hash_password(password: &str) -> String {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        format!("{:x}", hasher.finalize())
    }
}
