use crate::CoreError;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use keyring::Entry;
use pbkdf2::pbkdf2_hmac;
use ring::signature;
use ring::agreement;
use ring::rand::SecureRandom;
use sha2::Sha256;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::process::Command;
use totp_rs::{Algorithm, TOTP};

/// 跨平台硬體特徵碼（HWID）產生器
pub fn generate_hwid() -> Result<String, CoreError> {
    #[cfg(target_os = "windows")]
    {
        // 透過 winreg 讀取 MachineGuid
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(crypto_key) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
            if let Ok(guid) = crypto_key.get_value::<String, _>("MachineGuid") {
                return Ok(hash_hwid(&guid));
            }
        }
        
        // Fallback: 呼叫 wmic 獲取主機板 UUID
        let output = Command::new("wmic")
            .args(["csproduct", "get", "UUID"])
            .output()
            .map_err(|e| CoreError::SystemError(format!("執行 wmic 失敗: {}", e)))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = output_str.lines().collect();
        if lines.len() >= 2 {
            let uuid = lines[1].trim();
            if !uuid.is_empty() {
                return Ok(hash_hwid(uuid));
            }
        }
        Err(CoreError::SystemError("無法獲取 Windows 硬體特徵碼".to_string()))
    }

    #[cfg(target_os = "macos")]
    {
        // 呼叫 ioreg 獲取 IOPlatformUUID
        let output = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .map_err(|e| CoreError::SystemError(format!("執行 ioreg 失敗: {}", e)))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            if line.contains("IOPlatformUUID") {
                let parts: Vec<&str> = line.split('=').collect();
                if parts.len() == 2 {
                    let uuid = parts[1].trim().trim_matches('"');
                    return Ok(hash_hwid(uuid));
                }
            }
        }
        Err(CoreError::SystemError("無法獲取 macOS 硬體特徵碼".to_string()))
    }

    #[cfg(target_os = "ios")]
    {
        // iOS 平台：使用 Keychain 持久化 UUID 作為 HWID
        // iOS 的 UIDevice.identifierForVendor 在 App 重新安裝後會重設，
        // 因此改用 Keychain 儲存一個永久性 UUID，即使 App 重灌也能保留。
        use std::process::Command;

        // 嘗試用 security CLI 讀取 Keychain 中已存的 UUID
        let label = "com.twosyn.app.hwid";

        // 在 iOS Sandbox 環境中，Keychain 可透過 Security framework 存取，
        // 但 Rust 層直接呼叫需透過 sys 層。此處用環境變數 Fallback 供 PoC。
        // 實際產品需透過 Swift plugin 呼叫 Security.framework 的 SecItemCopyMatching。
        if let Ok(existing) = std::env::var("TWOSYN_DEVICE_UUID") {
            return Ok(hash_hwid(&existing));
        }

        // 產生一個新的 UUID 並儲存（PoC 層級：實際需呼叫 Keychain API）
        let new_uuid = format!(
            "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
            rand_u32(), rand_u16(), rand_u16(), rand_u16(), rand_u48()
        );
        Ok(hash_hwid(&new_uuid))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios")))]
    {
        // Linux / Android 平台 Fallback
        use std::fs;
        if let Ok(id) = fs::read_to_string("/etc/machine-id") {
            return Ok(hash_hwid(id.trim()));
        }
        if let Ok(id) = fs::read_to_string("/var/lib/dbus/machine-id") {
            return Ok(hash_hwid(id.trim()));
        }
        Err(CoreError::SystemError("不支援的作業系統或無法獲取機器特徵碼".to_string()))
    }
}

// iOS UUID 產生輔助函數（使用 ring 的隨機數）
#[cfg(target_os = "ios")]
fn rand_u32() -> u32 {
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut buf = [0u8; 4];
    let _ = rng.fill(&mut buf);
    u32::from_le_bytes(buf)
}
#[cfg(target_os = "ios")]
fn rand_u16() -> u16 {
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut buf = [0u8; 2];
    let _ = rng.fill(&mut buf);
    u16::from_le_bytes(buf)
}
#[cfg(target_os = "ios")]
fn rand_u48() -> u64 {
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut buf = [0u8; 6];
    let _ = rng.fill(&mut buf);
    let mut tmp = [0u8; 8];
    tmp[..6].copy_from_slice(&buf);
    u64::from_le_bytes(tmp)
}


/// 將硬體識別碼透過 SHA-256 雜湊，保護使用者隱私
fn hash_hwid(raw_id: &str) -> String {
    use sha2::Digest;
    let mut hasher = Sha256::new();
    hasher.update(raw_id.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// 本地端安全儲存封裝（使用系統 Keychain / Credential Manager）
pub struct SecureStorage;

impl SecureStorage {
    const SERVICE_NAME: &'static str = "2syn-remote-desktop";

    /// 儲存機密資訊至安全區
    pub fn save_secret(key: &str, secret: &str) -> Result<(), CoreError> {
        let entry = Entry::new(Self::SERVICE_NAME, key)
            .map_err(|e| CoreError::StorageError(format!("建立安全區 Entry 失敗: {}", e)))?;
        
        entry.set_password(secret)
            .map_err(|e| CoreError::StorageError(format!("寫入機密資訊至安全區失敗: {}", e)))?;
        
        Ok(())
    }

    /// 從安全區讀取機密資訊
    pub fn load_secret(key: &str) -> Result<String, CoreError> {
        let entry = Entry::new(Self::SERVICE_NAME, key)
            .map_err(|e| CoreError::StorageError(format!("建立安全區 Entry 失敗: {}", e)))?;
        
        entry.get_password()
            .map_err(|e| CoreError::StorageError(format!("從安全區讀取機密資訊失敗: {}", e)))
    }

    /// 從安全區刪除機密資訊
    pub fn delete_secret(key: &str) -> Result<(), CoreError> {
        let entry = Entry::new(Self::SERVICE_NAME, key)
            .map_err(|e| CoreError::StorageError(format!("建立安全區 Entry 失敗: {}", e)))?;
        
        entry.delete_password()
            .map_err(|e| CoreError::StorageError(format!("從安全區刪除機密資訊失敗: {}", e)))
    }
}

/// 軍規 AES-256-GCM 資料加密與解密
pub struct Encryptor;

impl Encryptor {
    /// 透過 PBKDF2 進行金鑰衍生（KDF）
    pub fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
        let mut key = [0u8; 32];
        pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, 100_000, &mut key);
        key
    }

    /// 加密資料
    pub fn encrypt(data: &[u8], key: &[u8; 32], nonce: &[u8; 12]) -> Result<Vec<u8>, CoreError> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| CoreError::CryptoError(format!("初始化 AES-256-GCM 密碼器失敗: {}", e)))?;
        
        let gcm_nonce = Nonce::from_slice(nonce);
        
        cipher.encrypt(gcm_nonce, data)
            .map_err(|e| CoreError::CryptoError(format!("資料加密失敗: {}", e)))
    }

    /// 解密資料
    pub fn decrypt(encrypted_data: &[u8], key: &[u8; 32], nonce: &[u8; 12]) -> Result<Vec<u8>, CoreError> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| CoreError::CryptoError(format!("初始化 AES-256-GCM 密碼器失敗: {}", e)))?;
        
        let gcm_nonce = Nonce::from_slice(nonce);
        
        cipher.decrypt(gcm_nonce, encrypted_data)
            .map_err(|e| CoreError::CryptoError(format!("資料解密失敗: {}", e)))
    }
}

/// 本地端一次性買斷授權驗證器
pub struct LicenseValidator;

impl LicenseValidator {
    // 伺服器官方 Ed25519 公鑰，用於驗證由伺服器私鑰簽發的憑證 (Activation Ticket)
    pub const SERVER_PUBLIC_KEY: [u8; 32] = [
        240, 45, 123, 170, 114, 25, 87, 250, 186, 155, 245, 112, 101, 188, 142, 80, 
        96, 138, 206, 138, 232, 105, 150, 107, 23, 249, 156, 78, 57, 241, 58, 167
    ];

    /// 驗證啟用憑證是否合法（非對稱 Ed25519 簽章驗證，可完全離線執行）
    /// 啟用憑證格式：`LicenseKey|HWID|Timestamp.SignatureHex`
    pub fn verify_license(license_str: &str, public_key_der: &[u8]) -> Result<bool, CoreError> {
        let parts: Vec<&str> = license_str.split('.').collect();
        if parts.len() != 2 {
            return Ok(false);
        }
        
        let payload = parts[0];
        let signature_hex = parts[1];
        
        let signature_bytes = hex::decode(signature_hex)
            .map_err(|_| CoreError::CryptoError("啟用憑證簽章格式錯誤".to_string()))?;
        
        // 為了 PoC，若無帶公鑰則預設使用零陣列
        let pub_key = if public_key_der.is_empty() || public_key_der == [0u8; 32] {
            &Self::SERVER_PUBLIC_KEY[..]
        } else {
            public_key_der
        };
        
        let peer_public_key = signature::UnparsedPublicKey::new(&signature::ED25519, pub_key);
        
        match peer_public_key.verify(payload.as_bytes(), &signature_bytes) {
            Ok(_) => {
                // 檢查 HWID 是否符合本機特徵碼，以防複製 Keychain 檔案防弊
                let hwid = generate_hwid()?;
                let payload_parts: Vec<&str> = payload.split('|').collect();
                if payload_parts.len() < 3 {
                    return Ok(false);
                }
                
                // 憑證格式 payload_parts: [LicenseKey, HWID, Timestamp]
                let licensed_hwid = payload_parts[1];
                Ok(licensed_hwid == hwid)
            }
            Err(_) => Ok(false),
        }
    }
}

/// TOTP 雙重驗證模組
pub struct TotpAuthenticator;

impl TotpAuthenticator {
    /// 產生全新的 TOTP 金鑰與配置，完全自定義以防範編譯器版本衝突
    pub fn new_secret(user_email: &str) -> Result<(String, String), CoreError> {
        let rng = ring::rand::SystemRandom::new();
        let mut raw_bytes = [0u8; 20];
        rng.fill(&mut raw_bytes)
            .map_err(|e| CoreError::CryptoError(format!("無法產生 TOTP 隨機熵: {}", e)))?;
            
        // 產生 RFC4648 標準 Base32 字串
        let secret_str = base32::encode(base32::Alphabet::Rfc4648 { padding: false }, &raw_bytes);
        
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            raw_bytes.to_vec(),
            Some("2syn-Remote".to_string()),
            user_email.to_string(),
        ).map_err(|e| CoreError::CryptoError(format!("初始化 TOTP 失敗: {}", e)))?;
        
        // 呼叫 get_url() 取得 otpauth 連結（可用於 QR Code）
        let qr_code_url = totp.get_url();
            
        Ok((secret_str, qr_code_url))
    }

    /// 驗證 TOTP Code 是否正確
    pub fn verify_code(secret_base32: &str, token: &str) -> Result<bool, CoreError> {
        let raw_bytes = base32::decode(base32::Alphabet::Rfc4648 { padding: false }, secret_base32)
            .ok_or_else(|| CoreError::CryptoError("無法將 TOTP 金鑰由 Base32 解碼".to_string()))?;
            
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            raw_bytes,
            Some("2syn-Remote".to_string()),
            "client@2syn.local".to_string(),
        ).map_err(|e| CoreError::CryptoError(format!("初始化 TOTP 失敗: {}", e)))?;
        
        Ok(totp.check_current(token).unwrap_or(false))
    }
}

// =========================================================================
// 去中心化安全握手協定 (ECDH X25519 + Ed25519 簽名防 MITM)
// =========================================================================

pub struct KeyExchangeSession {
    rng: ring::rand::SystemRandom,
}

impl Default for KeyExchangeSession {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyExchangeSession {
    pub fn new() -> Self {
        Self {
            rng: ring::rand::SystemRandom::new(),
        }
    }

    /// 產生一組新的臨時金鑰對 (Ephemeral Key Pair) 用於 ECDH
    ///
    /// 傳回: (X25519 臨時私鑰, X25519 臨時公鑰, 數位簽章)
    pub fn generate_signed_ephemeral(
        &self,
        local_ed25519_private_key_der: &[u8],
    ) -> Result<(agreement::EphemeralPrivateKey, Vec<u8>, Vec<u8>), CoreError> {
        // 產生 X25519 臨時私鑰與公鑰
        let ephemeral_private = agreement::EphemeralPrivateKey::generate(&agreement::X25519, &self.rng)
            .map_err(|e| CoreError::CryptoError(format!("無法產生 X25519 臨時金鑰: {}", e)))?;
            
        let ephemeral_public = ephemeral_private.compute_public_key()
            .map_err(|e| CoreError::CryptoError(format!("無法計算 X25519 公鑰: {}", e)))?;
            
        let ephemeral_public_bytes = ephemeral_public.as_ref().to_vec();

        // 使用 Ed25519 私鑰對該 X25519 臨時公鑰進行數位簽章
        let key_pair = signature::Ed25519KeyPair::from_pkcs8(local_ed25519_private_key_der)
            .map_err(|e| CoreError::CryptoError(format!("載入本機 Ed25519 私鑰失敗: {}", e)))?;
            
        let signature_bytes = key_pair.sign(&ephemeral_public_bytes).as_ref().to_vec();

        Ok((ephemeral_private, ephemeral_public_bytes, signature_bytes))
    }

    /// 2. 驗證對方的 X25519 臨時公鑰簽章，並在驗證成功後計算共用金鑰，進一步衍生 AES-256-GCM 對稱金鑰
    pub fn verify_and_agree(
        self,
        peer_ed25519_public_key_der: &[u8],
        peer_ephemeral_public_bytes: &[u8],
        peer_signature_bytes: &[u8],
        local_ephemeral_private: agreement::EphemeralPrivateKey,
    ) -> Result<[u8; 32], CoreError> {
        // 先驗證對方的 Ed25519 簽章，防止中間人修改 X25519 臨時公鑰
        let peer_pub_key = signature::UnparsedPublicKey::new(&signature::ED25519, peer_ed25519_public_key_der);
        peer_pub_key.verify(peer_ephemeral_public_bytes, peer_signature_bytes)
            .map_err(|_| CoreError::CryptoError("中間人攻擊警告：對方的臨時金鑰簽章驗證失敗！".to_string()))?;

        // 執行 ECDH 金鑰交換
        let peer_x25519_pub = agreement::UnparsedPublicKey::new(&agreement::X25519, peer_ephemeral_public_bytes);
        
        let shared_key = agreement::agree_ephemeral(
            local_ephemeral_private,
            &peer_x25519_pub,
            |shared_secret| {
                // 使用 SHA-256 當作簡單的金鑰衍生函式 (KDF) 產生 256 位元的對稱金鑰
                use sha2::Digest;
                let mut hasher = Sha256::new();
                hasher.update(shared_secret);
                let result = hasher.finalize();
                let mut derived_key = [0u8; 32];
                derived_key.copy_from_slice(&result);
                Ok::<[u8; 32], ring::error::Unspecified>(derived_key)
            },
        ).map_err(|_| CoreError::CryptoError("金鑰協商同意失敗".to_string()))?;

        shared_key.map_err(|_| CoreError::CryptoError("金鑰協商同意失敗".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::KeyPair;
    #[test]
    fn test_gen_key() {
        let rng = ring::rand::SystemRandom::new();
        let pkcs8 = signature::Ed25519KeyPair::generate_pkcs8(&rng).unwrap();
        let pkcs8_bytes = pkcs8.as_ref();
        let key_pair = signature::Ed25519KeyPair::from_pkcs8(pkcs8_bytes).unwrap();
        let public_key = key_pair.public_key().as_ref();
        println!("PKCS8_DER_BYTES: {:?}", pkcs8_bytes);
        println!("PUBLIC_KEY_BYTES: {:?}", public_key);
        panic!("Show output");
    }
}

