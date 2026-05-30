use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use dirs::download_dir;

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "action")]
pub enum FileTransferMessage {
    #[serde(rename = "start")]
    Start { name: String, size: u64 },
    #[serde(rename = "end")]
    End,
}

pub struct FileTransferState {
    current_file: Option<File>,
    current_path: Option<PathBuf>,
}

impl FileTransferState {
    pub fn new() -> Self {
        Self {
            current_file: None,
            current_path: None,
        }
    }

    pub fn handle_message(&mut self, msg_str: &str) {
        if let Ok(msg) = serde_json::from_str::<FileTransferMessage>(msg_str) {
            match msg {
                FileTransferMessage::Start { name, size: _ } => {
                    if let Some(mut dl_dir) = download_dir() {
                        dl_dir.push("2syn_downloads");
                        let _ = std::fs::create_dir_all(&dl_dir);
                        dl_dir.push(name);
                        self.current_path = Some(dl_dir.clone());
                        self.current_file = File::create(dl_dir).ok();
                        println!("[file-transfer] Started receiving file: {:?}", self.current_path);
                    }
                }
                FileTransferMessage::End => {
                    if let Some(path) = &self.current_path {
                        println!("[file-transfer] Finished receiving file: {:?}", path);
                    }
                    self.current_file = None;
                    self.current_path = None;
                }
            }
        }
    }

    pub fn handle_binary(&mut self, data: &[u8]) {
        if let Some(ref mut file) = self.current_file {
            if let Err(e) = file.write_all(data) {
                eprintln!("[file-transfer] Failed to write binary chunk: {}", e);
            }
        }
    }
}
