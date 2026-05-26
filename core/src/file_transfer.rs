/// 檔案傳輸引擎（File Transfer Engine）
///
/// 設計原則：
/// 1. **P2P 限定**：後端強制拒絕 Relay 狀態下的傳輸請求（成本封鎖）。
/// 2. **分塊傳輸**：每塊 16 KiB，適配 WebRTC Data Channel 的 MTU 限制。
/// 3. **進度追蹤**：透過 AtomicU64 進行執行緒安全的進度回報。
/// 4. **取消支援**：傳輸進行中可發出取消訊號。

use crate::connection::ConnectionType;
use crate::CoreError;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

/// 每個分塊的大小（16 KiB）
pub const CHUNK_SIZE: usize = 16 * 1024;

/// 傳輸狀態
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum TransferStatus {
    Idle,
    Sending,
    Receiving,
    Completed,
    Cancelled,
    Failed(String),
}

/// 單一傳輸任務描述
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileTransferTask {
    pub task_id: String,
    pub file_name: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub status: TransferStatus,
    /// 進度百分比（0~100）
    pub progress_pct: f32,
}

/// 執行緒安全的傳輸進度共享狀態
pub struct TransferProgress {
    pub total_bytes: u64,
    pub transferred_bytes: Arc<AtomicU64>,
    pub cancelled: Arc<AtomicBool>,
    pub completed: Arc<AtomicBool>,
    pub file_name: String,
    pub task_id: String,
}

impl TransferProgress {
    pub fn new(task_id: &str, file_name: &str, total_bytes: u64) -> Self {
        Self {
            total_bytes,
            transferred_bytes: Arc::new(AtomicU64::new(0)),
            cancelled: Arc::new(AtomicBool::new(false)),
            completed: Arc::new(AtomicBool::new(false)),
            file_name: file_name.to_string(),
            task_id: task_id.to_string(),
        }
    }

    pub fn progress_pct(&self) -> f32 {
        if self.total_bytes == 0 {
            return 0.0;
        }
        let transferred = self.transferred_bytes.load(Ordering::Relaxed);
        (transferred as f32 / self.total_bytes as f32 * 100.0).min(100.0)
    }

    pub fn snapshot(&self) -> FileTransferTask {
        let transferred = self.transferred_bytes.load(Ordering::Relaxed);
        let is_cancelled = self.cancelled.load(Ordering::Relaxed);
        let is_completed = self.completed.load(Ordering::Relaxed);

        let status = if is_cancelled {
            TransferStatus::Cancelled
        } else if is_completed {
            TransferStatus::Completed
        } else {
            TransferStatus::Sending
        };

        FileTransferTask {
            task_id: self.task_id.clone(),
            file_name: self.file_name.clone(),
            total_bytes: self.total_bytes,
            transferred_bytes: transferred,
            progress_pct: self.progress_pct(),
            status,
        }
    }
}

/// 檔案傳輸引擎
pub struct FileTransferEngine {
    active_tasks: Arc<Mutex<Vec<TransferProgress>>>,
}

impl Default for FileTransferEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl FileTransferEngine {
    pub fn new() -> Self {
        Self {
            active_tasks: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// 核心安全閘門：後端強制驗證連線類型
    ///
    /// 規則：若連線類型為 Relay（TURN 中轉），直接拒絕，不進入任何傳輸邏輯。
    /// 這確保即使前端 UI 被繞過，後端依然封鎖會產生流量費用的路徑。
    /// ─────────────────────────────────────────────────────────────────────
    pub fn assert_p2p_only(connection_type: ConnectionType) -> Result<(), CoreError> {
        if connection_type == ConnectionType::Relay {
            return Err(CoreError::NetworkError(
                "file_transfer_disabled_relay".to_string(),
            ));
        }
        Ok(())
    }

    /// 從本機路徑讀取檔案，回傳 (檔名, 總位元組數, 分塊迭代器)
    pub async fn prepare_send(
        path: &str,
        connection_type: ConnectionType,
    ) -> Result<(String, u64, Vec<Vec<u8>>), CoreError> {
        // ── 安全閘門（後端強制）──
        Self::assert_p2p_only(connection_type)?;

        // 讀取檔案
        let file_bytes = tokio::fs::read(path)
            .await
            .map_err(|e| CoreError::StorageError(format!("無法讀取檔案: {}", e)))?;

        let total_bytes = file_bytes.len() as u64;

        // 取得純檔名（去掉路徑）
        let file_name = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown_file")
            .to_string();

        // 分塊切割（16 KiB per chunk）
        let chunks: Vec<Vec<u8>> = file_bytes
            .chunks(CHUNK_SIZE)
            .map(|c| c.to_vec())
            .collect();

        Ok((file_name, total_bytes, chunks))
    }

    /// 取得所有任務的快照（供前端輪詢）
    pub async fn get_all_snapshots(&self) -> Vec<FileTransferTask> {
        let tasks = self.active_tasks.lock().await;
        tasks.iter().map(|t| t.snapshot()).collect()
    }

    /// 取消指定任務
    pub async fn cancel_task(&self, task_id: &str) -> bool {
        let tasks = self.active_tasks.lock().await;
        for task in tasks.iter() {
            if task.task_id == task_id {
                task.cancelled.store(true, Ordering::Relaxed);
                return true;
            }
        }
        false
    }

    /// 清除已完成或已取消的任務（保持清單整潔）
    pub async fn cleanup_finished(&self) {
        let mut tasks = self.active_tasks.lock().await;
        tasks.retain(|t| {
            !t.completed.load(Ordering::Relaxed) && !t.cancelled.load(Ordering::Relaxed)
        });
    }

    /// 建立新的傳輸進度記錄並加入追蹤清單
    pub async fn register_task(
        &self,
        task_id: &str,
        file_name: &str,
        total_bytes: u64,
    ) -> Arc<AtomicU64> {
        let progress = TransferProgress::new(task_id, file_name, total_bytes);
        let transferred_bytes = Arc::clone(&progress.transferred_bytes);
        self.active_tasks.lock().await.push(progress);
        transferred_bytes
    }
}

/// 接收端用於重組分塊的緩衝區
#[derive(Debug)]
pub struct ChunkReassembler {
    pub file_name: String,
    pub total_bytes: u64,
    pub received_chunks: Vec<Vec<u8>>,
    pub received_bytes: u64,
}

impl ChunkReassembler {
    pub fn new(file_name: &str, total_bytes: u64) -> Self {
        Self {
            file_name: file_name.to_string(),
            total_bytes,
            received_chunks: Vec::new(),
            received_bytes: 0,
        }
    }

    /// 追加新收到的分塊
    pub fn push_chunk(&mut self, chunk: Vec<u8>) {
        self.received_bytes += chunk.len() as u64;
        self.received_chunks.push(chunk);
    }

    /// 判斷是否接收完畢
    pub fn is_complete(&self) -> bool {
        self.received_bytes >= self.total_bytes
    }

    /// 將所有分塊合併為完整檔案位元組
    pub fn assemble(&self) -> Vec<u8> {
        let mut result = Vec::with_capacity(self.total_bytes as usize);
        for chunk in &self.received_chunks {
            result.extend_from_slice(chunk);
        }
        result
    }
}
