use std::sync::Arc;
use tokio::sync::Mutex;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::media::Sample;
use std::time::Duration;
use xcap::Monitor;
use crate::codec::{VideoHardwareEncoder, CaptureCodecFactory, CodecParams, VideoCodecType};

pub struct VideoStreamer {
    track: Arc<TrackLocalStaticSample>,
    encoder: Arc<Mutex<Box<dyn VideoHardwareEncoder + Send + Sync>>>,
}

impl VideoStreamer {
    pub fn new(track: Arc<TrackLocalStaticSample>) -> Result<Self, String> {
        let mut encoder = CaptureCodecFactory::create_encoder();
        
        let params = CodecParams {
            width: 1920,
            height: 1080,
            bitrate_kbps: 6000,
            fps: 60,
            codec_type: VideoCodecType::H264,
        };
        
        encoder.init(params).map_err(|e| format!("Failed to init encoder: {:?}", e))?;
        
        // Since we need to wrap our encoder in Arc<Mutex<...>> it requires Send + Sync.
        // We'll trust the underlying implementation to be thread-safe for our basic usage,
        // but we need to ensure the dyn trait expresses it. We'll add a wrapper if needed.
        // For now, let's assume the box can be coerced or we define a custom wrapper.
        
        Ok(Self {
            track,
            encoder: Arc::new(Mutex::new(encoder)),
        })
    }

    pub async fn start_capture_loop(
        &self,
        status_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
        config_rx: tokio::sync::watch::Receiver<crate::connection::QualityConfig>,
        monitor_rx: tokio::sync::watch::Receiver<usize>,
    ) {
        let encoder_arc = Arc::clone(&self.encoder);
        let track_arc = Arc::clone(&self.track);

        // 建立一個有界通道，用於將編碼後的資料從同步執行緒送回非同步任務中發送
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(10);

        // 啟動非同步任務負責按順序傳送視訊幀 (避免 out-of-order 導致 H264 解碼失敗)
        tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                let sample = Sample {
                    data: data.into(),
                    duration: Duration::from_millis(33),
                    ..Default::default()
                };
                match tokio::time::timeout(std::time::Duration::from_millis(100), track_arc.write_sample(&sample)).await {
                    Ok(Err(e)) => eprintln!("[Video] 傳送視訊幀失敗: {}", e),
                    Err(_) => eprintln!("[Video] 傳送視訊幀逾時 (網路擁塞)"),
                    Ok(Ok(_)) => {}
                }
            }
        });

        tokio::task::spawn_blocking(move || {
            let mut tick = std::time::Instant::now();
            let mut frame_count: u64 = 0;
            
            // 初始化 Monitor
            let mut current_monitor_index = *monitor_rx.borrow();
            let mut monitors = Monitor::all().unwrap_or_default();
            let mut monitor_clone = if !monitors.is_empty() {
                Some(monitors[current_monitor_index.min(monitors.len() - 1)].clone())
            } else {
                None
            };
            
            // 紀錄上次套用的 ABR 配置
            let mut last_applied_bitrate = 0;
            let mut last_applied_fps = 0;

            loop {
                // catch_unwind 防線：確保任何內部 panic 不會傳播到 tao 主執行緒
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // 從 config_rx 取得當前的網路品質配置 (無鎖同步讀取)
                let current_config = config_rx.borrow().clone();
                let target_fps = current_config.target_fps.max(1); // 避免為 0
                let frame_time = std::time::Duration::from_millis((1000 / target_fps) as u64);
                
                // 若 ABR 觸發了品質變更，通知硬體編碼器動態調整
                if current_config.bitrate_limit_kbps != last_applied_bitrate || target_fps != last_applied_fps {
                    if let Ok(mut encoder_guard) = encoder_arc.try_lock() {
                        if let Err(e) = encoder_guard.reconfigure(current_config.bitrate_limit_kbps, target_fps) {
                            eprintln!("[Video] 動態調整編碼器失敗: {}", e);
                        } else {
                            last_applied_bitrate = current_config.bitrate_limit_kbps;
                            last_applied_fps = target_fps;
                            let _ = encoder_guard.force_intra_frame();
                        }
                    }
                }
                
                // 檢查是否需要切換螢幕
                let requested_monitor_index = *monitor_rx.borrow();
                if requested_monitor_index != current_monitor_index {
                    current_monitor_index = requested_monitor_index;
                    monitors = Monitor::all().unwrap_or_default();
                    if !monitors.is_empty() {
                        monitor_clone = Some(monitors[current_monitor_index.min(monitors.len() - 1)].clone());
                    }
                    // 強制觸發 IDR 幀以利前端解碼器重置
                    if let Ok(mut encoder_guard) = encoder_arc.try_lock() {
                        let _ = encoder_guard.force_intra_frame();
                    }
                }

                // 根據頻寬限制動態決定畫面解析度上限 (ABR 降階邏輯)
                let max_width = if current_config.bitrate_limit_kbps < 3000 {
                    854.0 // 480p 級別
                } else if current_config.bitrate_limit_kbps < 10000 {
                    1280.0 // 720p 級別
                } else {
                    1920.0 // 1080p 級別
                };
                
                // 擷取螢幕
                let capture_result = if let Some(ref m) = monitor_clone {
                    Some(m.capture_image())
                } else {
                    None
                };

                if let Some(Ok(mut image)) = capture_result {
                    let mut width = image.width() as usize;
                    let mut height = image.height() as usize;
                    
                    // 防呆：擷取到空白畫面時跳過此幀
                    if width == 0 || height == 0 {
                        return;
                    }
                    
                    // 動態降階解析度以符合當前網路頻寬
                    if width as f32 > max_width {
                        let scale = max_width / width as f32;
                        let new_width = (max_width as u32).max(2);
                        let new_height = ((height as f32 * scale) as u32).max(2);
                        image = image::imageops::resize(
                            &image,
                            new_width,
                            new_height,
                            image::imageops::FilterType::Nearest
                        );
                        width = image.width() as usize;
                        height = image.height() as usize;
                    }

                    // 為了確保 YUV 420 轉換正常，長寬必須是偶數且至少為 2
                    let adj_width = if width % 2 != 0 { width - 1 } else { width };
                    let adj_height = if height % 2 != 0 { height - 1 } else { height };
                    
                    if adj_width < 2 || adj_height < 2 {
                        return;
                    }

                    
                    // 在同步區塊中取得 encoder 並進行編碼
                    if let Ok(mut encoder_guard) = encoder_arc.try_lock() {
                        if frame_count % 30 == 0 {
                            let _ = encoder_guard.force_intra_frame();
                        }
                        frame_count += 1;
                        
                        match encoder_guard.encode_rgba_frame(image.as_raw(), adj_width as u32, adj_height as u32) {
                            Ok(encoded) => {
                                let data = encoded.to_vec();
                                if !data.is_empty() {
                                    if frame_count % 30 == 1 {
                                        println!("[Video] Encoded frame size: {} bytes", data.len());
                                    }
                                    if let Err(_e) = tx.try_send(data) {
                                        // 可以在這裡加入除錯訊息，表示網路擁塞導致掉幀
                                    }
                                }
                            }
                            Err(e) => {
                                let msg = format!("H.264 Encoding failed: {:?}", e);
                                eprintln!("[Video] {}", msg);
                                if let Some(tx) = &status_tx {
                                    let _ = tx.send(msg);
                                }
                            }
                        }
                    }
                } else if let Some(Err(err)) = capture_result {
                    let msg = format!("Screen capture failed (Missing permissions?): {:?}", err);
                    eprintln!("[Video] {}", msg);
                    if let Some(tx) = &status_tx {
                        let _ = tx.send(msg);
                    }
                }

                let elapsed = tick.elapsed();
                if elapsed < frame_time {
                    std::thread::sleep(frame_time - elapsed);
                }
                tick = std::time::Instant::now();
                })); // end catch_unwind closure
                
                if let Err(panic_info) = result {
                    eprintln!("[Video] Capture loop caught panic: {:?}", panic_info);
                    // 短暫休眠後繼續，避免無限快速迴圈
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    tick = std::time::Instant::now();
                }
            }
        });
    }
}
