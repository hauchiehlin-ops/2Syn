use dirs::download_dir;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "action")]
pub enum FileTransferMessage {
    #[serde(rename = "start")]
    Start {
        id: Option<String>,
        name: String,
        size: u64,
        fingerprint: Option<String>,
    },
    #[serde(rename = "resume")]
    Resume {
        id: Option<String>,
        offset: u64,
    },
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
        Self {
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
                } => {
                    if let Some(mut dl_dir) = download_dir() {
                        dl_dir.push("2syn-transfers");
                        let _ = std::fs::create_dir_all(&dl_dir);
                        let safe_name = sanitize_file_name(&name);
                        let path = unique_download_path(&dl_dir, &safe_name);
                        let part_path = resume_part_path(&dl_dir, &safe_name, size, fingerprint.as_deref());
                        let existing_len = match std::fs::metadata(&part_path).map(|meta| meta.len()) {
                            Ok(len) if len <= size => len,
                            Ok(_) => {
                                let _ = std::fs::remove_file(&part_path);
                                0
                            }
                            Err(_) => 0,
                        };
                        self.current_id = id;
                        self.current_path = Some(path.clone());
                        self.current_part_path = Some(part_path.clone());
                        self.current_received = existing_len;
                        self.current_expected_size = size;
                        self.current_name = Some(safe_name);
                        self.last_progress_reported = existing_len;
                        self.current_file = OpenOptions::new()
                            .write(true)
                            .create(true)
                            .append(existing_len > 0)
                            .truncate(existing_len == 0)
                            .open(part_path)
                            .ok();
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
        if let Some(ref mut file) = self.current_file {
            if let Err(e) = file.write_all(data) {
                eprintln!("[file-transfer] Failed to write binary chunk: {}", e);
                return;
            }
            self.current_received += data.len() as u64;
            if self.current_received == self.current_expected_size
                || self.current_received.saturating_sub(self.last_progress_reported) >= 1024 * 1024
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
