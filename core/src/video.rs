use std::sync::Arc;
use tokio::sync::Mutex;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::media::Sample;
use std::time::Duration;
#[cfg(not(target_os = "macos"))]
use xcap::Monitor;

#[cfg(target_os = "macos")]
use screencapturekit::shareable_content::SCShareableContent;
#[cfg(target_os = "macos")]
use screencapturekit::screenshot_manager::SCScreenshotManager;
#[cfg(target_os = "macos")]
use screencapturekit::stream::configuration::SCStreamConfiguration;
#[cfg(target_os = "macos")]
use screencapturekit::stream::content_filter::SCContentFilter;
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
        
        // 使用 autoreleasepool 包裝硬體編碼器的初始化，防止 macOS WindowServer 在背景執行緒中死鎖
        #[cfg(target_os = "macos")]
        {
            let init_res: Result<(), String> = objc::rc::autoreleasepool(|| {
                encoder.init(params).map_err(|e| format!("Failed to init encoder: {:?}", e))
            });
            init_res?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            encoder.init(params).map_err(|e| format!("Failed to init encoder: {:?}", e))?;
        }
        
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
        active_webrtc: Arc<std::sync::atomic::AtomicBool>,
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
            #[cfg(not(target_os = "macos"))]
            let mut monitors = Monitor::all().unwrap_or_default();
            #[cfg(not(target_os = "macos"))]
            let mut monitor_clone = if !monitors.is_empty() {
                Some(monitors[current_monitor_index.min(monitors.len() - 1)].clone())
            } else {
                None
            };
            
            // 紀錄上次套用的 ABR 配置
            let mut last_applied_bitrate = 0;
            let mut last_applied_fps = 0;
            let mut last_applied_width = 0;
            let mut last_applied_height = 0;

            #[cfg(target_os = "macos")]
            let mut macos_stream: Option<screencapturekit::async_api::AsyncSCStream> = None;

            loop {
                // catch_unwind 防線：確保任何內部 panic 不會傳播到 tao 主執行緒
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // 若目前 WebRTC 連線不活躍，則不執行擷取與編碼，直接休眠退避
                let is_active = active_webrtc.load(std::sync::atomic::Ordering::SeqCst);
                if !is_active {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    #[cfg(target_os = "macos")]
                    {
                        if let Some(stream) = macos_stream.take() {
                            let _ = stream.stop_capture();
                        }
                    }
                    return;
                }
                
                let current_config = config_rx.borrow().clone();
                let target_fps = current_config.target_fps.min(30).max(1); // 為防止 Mac 死機，硬性限制最高 30 FPS
                let frame_time = std::time::Duration::from_millis((1000 / target_fps) as u64);
                
                // 若 ABR 觸發了品質變更，通知硬體編碼器動態調整
                if current_config.bitrate_limit_kbps != last_applied_bitrate || target_fps != last_applied_fps || current_config.target_width != last_applied_width || current_config.target_height != last_applied_height {
                    if let Ok(mut encoder_guard) = encoder_arc.try_lock() {
                        if let Err(e) = encoder_guard.reconfigure(current_config.bitrate_limit_kbps, target_fps, current_config.target_width, current_config.target_height) {
                            eprintln!("[Video] 動態調整編碼器失敗: {}", e);
                        } else {
                            last_applied_bitrate = current_config.bitrate_limit_kbps;
                            last_applied_fps = target_fps;
                            last_applied_width = current_config.target_width;
                            last_applied_height = current_config.target_height;
                            let _ = encoder_guard.force_intra_frame();
                        }
                    }
                }
                
                // 檢查是否需要切換螢幕
                let requested_monitor_index = *monitor_rx.borrow();
                let mut monitor_changed = false;
                if requested_monitor_index != current_monitor_index {
                    current_monitor_index = requested_monitor_index;
                    monitor_changed = true;
                    #[cfg(not(target_os = "macos"))]
                    {
                        monitors = Monitor::all().unwrap_or_default();
                        if !monitors.is_empty() {
                            monitor_clone = Some(monitors[current_monitor_index.min(monitors.len() - 1)].clone());
                        }
                    }
                    // 強制觸發 IDR 幀以利前端解碼器重置
                    if let Ok(mut encoder_guard) = encoder_arc.try_lock() {
                        let _ = encoder_guard.force_intra_frame();
                    }
                }

                #[cfg(target_os = "macos")]
                {
                    if macos_stream.is_none() || monitor_changed {
                        if let Some(stream) = macos_stream.take() {
                            let _ = stream.stop_capture();
                        }
                        if let Ok(content) = screencapturekit::shareable_content::SCShareableContent::get() {
                            let displays = content.displays();
                            if let Some(display) = displays.get(current_monitor_index.min(displays.len().saturating_sub(1))) {
                                let filter = screencapturekit::stream::content_filter::SCContentFilter::builder().display(display).build();
                                let min_frame_interval = screencapturekit::cm::CMTime::new(1, target_fps as i32);
                                let config = screencapturekit::stream::configuration::SCStreamConfiguration::new()
                                    .with_shows_cursor(false)
                                    .with_pixel_format(screencapturekit::stream::configuration::PixelFormat::YCbCr_420v)
                                    .with_minimum_frame_interval(&min_frame_interval);
                                let stream = screencapturekit::async_api::AsyncSCStream::new(&filter, &config, 5, screencapturekit::stream::output_type::SCStreamOutputType::Screen);
                                let _ = stream.start_capture();
                                macos_stream = Some(stream);
                            }
                        }
                    }
                }

                let mut capture_result: Option<Result<(Vec<u8>, u32, u32), String>> = None;

                #[cfg(target_os = "macos")]
                {
                    if let Some(stream) = &macos_stream {
                        // Blockingly wait for the next sample up to 100ms
                        let timeout_res = tokio::runtime::Handle::current().block_on(async {
                            tokio::time::timeout(std::time::Duration::from_millis(100), stream.next()).await
                        });
                        
                        match timeout_res {
                            Ok(Some(sample)) => {
                                if let Some(pixel_buf) = sample.image_buffer() {
                                    if let Some(io_surface) = pixel_buf.io_surface() {
                                        let ptr = io_surface.as_ptr();
                                        if let Ok(mut encoder_guard) = encoder_arc.try_lock() {
                                            match encoder_guard.encode_frame_zero_copy(&crate::codec::FrameBuffer::IOSurface(ptr)) {
                                                Ok(encoded_bytes) => {
                                                    let _ = tx.blocking_send(encoded_bytes);
                                                }
                                                Err(e) => {
                                                    crate::debug_log!("VIDEO", "Zero-copy encode failed: {:?}", e);
                                                }
                                            }
                                        }
                                    } else {
                                        crate::debug_log!("VIDEO", "No IOSurface found in CVPixelBuffer");
                                    }
                                }
                            }
                            Ok(None) => {
                                // Stream ended or encountered a fatal error (e.g. display disconnected or resolution changed).
                                // Drop the stream so it gets recreated on the next iteration.
                                crate::debug_log!("VIDEO", "SCStream ended, will recreate...");
                                macos_stream = None;
                            }
                            Err(_) => {
                                // Timeout. Expected behavior if screen content hasn't changed.
                            }
                        }
                    }
                }

                #[cfg(not(target_os = "macos"))]
                {
                    if let Some(ref m) = monitor_clone {
                        match m.capture_image() {
                            Ok(img) => {
                                let w = img.width();
                                let h = img.height();
                                capture_result = Some(Ok((img.into_raw(), w, h)));
                            }
                            Err(e) => {
                                capture_result = Some(Err(format!("{:?}", e)));
                            }
                        }
                    }
                }

                if let Some(Ok((bytes, width, height))) = capture_result {
                    let width = width as usize;
                    let height = height as usize;
                    
                    // 防呆：擷取到空白畫面時跳過此幀
                    if width == 0 || height == 0 {
                        return;
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
                        
                        crate::debug_log!("VIDEO", "Before encoder.encode_rgba_frame frame_count={} bytes_len={} w={} h={}", frame_count, bytes.len(), adj_width, adj_height);
                        let encode_result = encoder_guard.encode_rgba_frame(&bytes, adj_width as u32, adj_height as u32);
                        crate::debug_log!("VIDEO", "After encoder.encode_rgba_frame result={}", encode_result.is_ok());
                        
                        match encode_result {
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
                    // 擷取失敗時，強制休眠 100 毫秒，防止無間隔重試卡死系統
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }

                let elapsed = tick.elapsed();
                // 強制最低休眠 5 毫秒，釋放 CPU 資源以防止 WindowServer 渲染死鎖
                let sleep_time = if elapsed < frame_time {
                    (frame_time - elapsed).max(std::time::Duration::from_millis(5))
                } else {
                    std::time::Duration::from_millis(5)
                };
                std::thread::sleep(sleep_time);
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
