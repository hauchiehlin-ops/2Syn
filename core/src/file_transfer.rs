use dirs::download_dir;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const FRAME_HEADER_BYTES: usize = 16;
const FRAME_MAGIC: u32 = 0x3253_594e; // "2SYN"

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "action")]
pub enum FileTransferMessage {
    #[serde(rename = "start")]
    Start {
        id: Option<String>,
        name: String,
        size: u64,
        fingerprint: Option<String>,
        protocol: Option<String>,
    },
    #[serde(rename = "resume")]
    Resume { id: Option<String>, offset: u64 },
    #[serde(rename = "end")]
    End { id: Option<String> },
    #[serde(rename = "complete")]
    Complete {
        id: Option<String>,
        name: Option<String>,
        path: Option<String>,
        size: Option<u64>,
    },
    #[serde(rename = "cancel")]
    Cancel { id: Option<String> },
}

pub struct FileTransferState {
    download_dir: Option<PathBuf>,
    current_id: Option<String>,
    current_file: Option<File>,
    current_path: Option<PathBuf>,
    current_part_path: Option<PathBuf>,
    current_received: u64,
    current_expected_size: u64,
    current_name: Option<String>,
    last_progress_reported: u64,
    last_completed: Option<CompletedFileTransfer>,
    outgoing_messages: Vec<String>,
}

pub struct CompletedFileTransfer {
    pub name: String,
    pub path: PathBuf,
    pub size: u64,
}

impl FileTransferState {
    pub fn new() -> Self {
        Self::with_download_dir(download_dir())
    }

    pub fn with_download_dir(download_dir: Option<PathBuf>) -> Self {
        Self {
            download_dir,
            current_id: None,
            current_file: None,
            current_path: None,
            current_part_path: None,
            current_received: 0,
            current_expected_size: 0,
            current_name: None,
            last_progress_reported: 0,
            last_completed: None,
            outgoing_messages: Vec::new(),
        }
    }

    pub fn handle_message(&mut self, msg_str: &str) {
        if let Ok(msg) = serde_json::from_str::<FileTransferMessage>(msg_str) {
            match msg {
                FileTransferMessage::Start {
                    id,
                    name,
                    size,
                    fingerprint,
                    protocol: _,
                } => {
                    let transfer_id = id.clone();
                    if let Err(error) = self.start_receive(id, &name, size, fingerprint.as_deref())
                    {
                        eprintln!(
                            "[file-transfer] Failed to start receiving {}: {}",
                            name, error
                        );
                        self.reset();
                        self.outgoing_messages.push(
                            serde_json::json!({
                                "action": "cancel",
                                "id": transfer_id
                            })
                            .to_string(),
                        );
                    }
                }
                FileTransferMessage::Resume { .. } => {}
                FileTransferMessage::Complete { .. } => {}
                FileTransferMessage::End { id } => {
                    if !self.message_matches_current(id.as_deref()) {
                        return;
                    }
                    if let Some(path) = &self.current_path {
                        self.current_file = None;
                        if self.current_expected_size > 0
                            && self.current_received != self.current_expected_size
                        {
                            eprintln!(
                                "[file-transfer] File size mismatch for {:?}: received {} / expected {} bytes",
                                path,
                                self.current_received,
                                self.current_expected_size
                            );
                        } else {
                            if let Some(part_path) = &self.current_part_path {
                                let _ = std::fs::rename(part_path, path);
                            }
                            println!("[file-transfer] Finished receiving file: {:?}", path);
                            self.last_completed = Some(CompletedFileTransfer {
                                name: path
                                    .file_name()
                                    .and_then(|value| value.to_str())
                                    .unwrap_or("download.bin")
                                    .to_string(),
                                path: path.clone(),
                                size: self.current_received,
                            });
                            self.outgoing_messages.push(
                                serde_json::json!({
                                    "action": "complete",
                                    "id": self.current_id,
                                    "name": self.current_name,
                                    "path": format!("Downloads/2syn-transfers/{}", path.file_name().and_then(|value| value.to_str()).unwrap_or("download.bin")),
                                    "size": self.current_received
                                })
                                .to_string(),
                            );
                        }
                    }
                    self.reset();
                }
                FileTransferMessage::Cancel { id } => {
                    if !self.message_matches_current(id.as_deref()) {
                        return;
                    }
                    if let Some(path) = self.current_path.clone() {
                        let _ = std::fs::remove_file(path);
                    }
                    if let Some(path) = self.current_part_path.clone() {
                        let _ = std::fs::remove_file(path);
                    }
                    self.reset();
                }
            }
        }
    }

    pub fn handle_binary(&mut self, data: &[u8]) {
        if let Some((offset, payload)) = parse_chunk_frame(data) {
            self.write_chunk_at(offset, payload);
            return;
        }
        self.write_chunk_at(self.current_received, data);
    }

    fn write_chunk_at(&mut self, offset: u64, data: &[u8]) {
        if let Some(ref mut file) = self.current_file {
            if offset != self.current_received {
                if let Err(e) = file.seek(SeekFrom::Start(offset)) {
                    eprintln!(
                        "[file-transfer] Failed to seek chunk offset {}: {}",
                        offset, e
                    );
                    return;
                }
            }
            if let Err(e) = file.write_all(data) {
                eprintln!("[file-transfer] Failed to write binary chunk: {}", e);
                return;
            }
            self.current_received = self
                .current_received
                .max(offset.saturating_add(data.len() as u64));
            if self.current_received == self.current_expected_size
                || self
                    .current_received
                    .saturating_sub(self.last_progress_reported)
                    >= 1024 * 1024
            {
                self.last_progress_reported = self.current_received;
                self.outgoing_messages.push(
                    serde_json::json!({
                        "action": "progress",
                        "id": self.current_id,
                        "name": self.current_name,
                        "received": self.current_received,
                        "size": self.current_expected_size
                    })
                    .to_string(),
                );
            }
        }
    }

    pub fn take_completed(&mut self) -> Option<CompletedFileTransfer> {
        self.last_completed.take()
    }

    pub fn take_outgoing_messages(&mut self) -> Vec<String> {
        std::mem::take(&mut self.outgoing_messages)
    }

    fn start_receive(
        &mut self,
        id: Option<String>,
        name: &str,
        size: u64,
        fingerprint: Option<&str>,
    ) -> Result<(), String> {
        let mut dl_dir = self
            .download_dir
            .clone()
            .or_else(download_dir)
            .ok_or_else(|| "download directory is unavailable".to_string())?;
        dl_dir.push("2syn-transfers");
        std::fs::create_dir_all(&dl_dir)
            .map_err(|e| format!("failed to create receive directory {:?}: {}", dl_dir, e))?;

        let safe_name = sanitize_file_name(name);
        let path = unique_download_path(&dl_dir, &safe_name);
        let part_path = resume_part_path(&dl_dir, &safe_name, size, fingerprint);
        let existing_len = match std::fs::metadata(&part_path).map(|meta| meta.len()) {
            Ok(len) if len <= size => len,
            Ok(_) => {
                let _ = std::fs::remove_file(&part_path);
                0
            }
            Err(_) => 0,
        };

        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(existing_len == 0)
            .open(&part_path)
            .map_err(|e| format!("failed to open receive file {:?}: {}", part_path, e))?;
        file.seek(SeekFrom::Start(existing_len))
            .map_err(|e| format!("failed to seek receive file {:?}: {}", part_path, e))?;

        self.current_id = id;
        self.current_file = Some(file);
        self.current_path = Some(path.clone());
        self.current_part_path = Some(part_path);
        self.current_received = existing_len;
        self.current_expected_size = size;
        self.current_name = Some(safe_name);
        self.last_progress_reported = existing_len;
        self.outgoing_messages.push(
            serde_json::json!({
                "action": "resume",
                "id": self.current_id,
                "offset": existing_len
            })
            .to_string(),
        );
        println!(
            "[file-transfer] Started receiving file: {:?} ({} / {} bytes)",
            self.current_path, existing_len, size
        );
        Ok(())
    }

    fn message_matches_current(&self, id: Option<&str>) -> bool {
        id.is_none() || self.current_id.as_deref().is_none() || id == self.current_id.as_deref()
    }

    fn reset(&mut self) {
        self.current_id = None;
        self.current_file = None;
        self.current_path = None;
        self.current_part_path = None;
        self.current_received = 0;
        self.current_expected_size = 0;
        self.current_name = None;
        self.last_progress_reported = 0;
    }
}

fn sanitize_file_name(name: &str) -> String {
    let leaf = Path::new(name)
        .file_name()
        .and_then(|part| part.to_str())
        .unwrap_or("download.bin");
    let sanitized: String = leaf
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            _ => c,
        })
        .collect();

    let trimmed = sanitized.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "download.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_download_path(dir: &Path, file_name: &str) -> PathBuf {
    let mut candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let ext = path.extension().and_then(|s| s.to_str());

    for index in 1..1000 {
        let next_name = match ext {
            Some(ext) if !ext.is_empty() => format!("{} ({}){}.{}", stem, index, "", ext),
            _ => format!("{} ({})", stem, index),
        };
        candidate = dir.join(next_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    dir.join(format!("{} ({})", file_name, uuid::Uuid::new_v4()))
}

fn resume_part_path(dir: &Path, file_name: &str, size: u64, fingerprint: Option<&str>) -> PathBuf {
    let token = fingerprint
        .map(sanitize_file_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("{}-{}", file_name, size));
    dir.join(format!(".{}.part", token))
}

fn parse_chunk_frame(data: &[u8]) -> Option<(u64, &[u8])> {
    if data.len() < FRAME_HEADER_BYTES {
        return None;
    }
    let magic = u32::from_be_bytes(data[0..4].try_into().ok()?);
    if magic != FRAME_MAGIC {
        return None;
    }
    let high = u32::from_be_bytes(data[4..8].try_into().ok()?);
    let low = u32::from_be_bytes(data[8..12].try_into().ok()?);
    let length = u32::from_be_bytes(data[12..16].try_into().ok()?) as usize;
    if length > data.len().saturating_sub(FRAME_HEADER_BYTES) {
        return None;
    }
    let offset = ((high as u64) << 32) | low as u64;
    Some((
        offset,
        &data[FRAME_HEADER_BYTES..FRAME_HEADER_BYTES + length],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_receive_failure_sends_cancel() {
        let blocked_path = std::env::temp_dir().join(format!(
            "2syn-file-transfer-blocked-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&blocked_path, b"not a directory").unwrap();

        let mut state = FileTransferState::with_download_dir(Some(blocked_path.clone()));
        state.handle_message(
            r#"{"action":"start","id":"transfer-1","name":"example.txt","size":5,"fingerprint":"example"}"#,
        );

        let outgoing = state.take_outgoing_messages();
        let _ = std::fs::remove_file(blocked_path);
        assert_eq!(outgoing.len(), 1);

        let message: serde_json::Value = serde_json::from_str(&outgoing[0]).unwrap();
        assert_eq!(message["action"], "cancel");
        assert_eq!(message["id"], "transfer-1");
    }
}
