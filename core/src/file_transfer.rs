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
    },
    #[serde(rename = "end")]
    End { id: Option<String> },
    #[serde(rename = "cancel")]
    Cancel { id: Option<String> },
}

pub struct FileTransferState {
    current_id: Option<String>,
    current_file: Option<File>,
    current_path: Option<PathBuf>,
    current_received: u64,
    current_expected_size: u64,
}

impl FileTransferState {
    pub fn new() -> Self {
        Self {
            current_id: None,
            current_file: None,
            current_path: None,
            current_received: 0,
            current_expected_size: 0,
        }
    }

    pub fn handle_message(&mut self, msg_str: &str) {
        if let Ok(msg) = serde_json::from_str::<FileTransferMessage>(msg_str) {
            match msg {
                FileTransferMessage::Start { id, name, size } => {
                    if let Some(mut dl_dir) = download_dir() {
                        dl_dir.push("2syn_downloads");
                        let _ = std::fs::create_dir_all(&dl_dir);
                        let path = unique_download_path(&dl_dir, &sanitize_file_name(&name));
                        self.current_id = id;
                        self.current_path = Some(path.clone());
                        self.current_received = 0;
                        self.current_expected_size = size;
                        self.current_file = OpenOptions::new()
                            .write(true)
                            .create_new(true)
                            .open(path)
                            .ok();
                        println!(
                            "[file-transfer] Started receiving file: {:?} ({} bytes)",
                            self.current_path, size
                        );
                    }
                }
                FileTransferMessage::End { id } => {
                    if !self.message_matches_current(id.as_deref()) {
                        return;
                    }
                    if let Some(path) = &self.current_path {
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
                            println!("[file-transfer] Finished receiving file: {:?}", path);
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
        }
    }

    fn message_matches_current(&self, id: Option<&str>) -> bool {
        id.is_none() || self.current_id.as_deref().is_none() || id == self.current_id.as_deref()
    }

    fn reset(&mut self) {
        self.current_id = None;
        self.current_file = None;
        self.current_path = None;
        self.current_received = 0;
        self.current_expected_size = 0;
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
