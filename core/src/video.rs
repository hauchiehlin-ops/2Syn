use std::sync::Arc;
use tokio::sync::Mutex;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::media::Sample;
use std::time::Duration;
use xcap::Monitor;
use openh264::encoder::{Encoder, EncoderConfig};
use openh264::formats::YUVSource;

pub struct VideoStreamer {
    track: Arc<TrackLocalStaticSample>,
    encoder: Arc<Mutex<Encoder>>,
}

/// 將 RGBA 轉換為 YUV420 平面格式
struct RgbaToYuv420 {
    y: Vec<u8>,
    u: Vec<u8>,
    v: Vec<u8>,
    width: usize,
    height: usize,
}

impl RgbaToYuv420 {
    fn new(rgba: &[u8], width: usize, height: usize) -> Self {
        let mut y_plane = vec![0u8; width * height];
        let mut u_plane = vec![0u8; (width / 2) * (height / 2)];
        let mut v_plane = vec![0u8; (width / 2) * (height / 2)];

        for j in 0..height {
            for i in 0..width {
                let idx = (j * width + i) * 4;
                let r = rgba[idx] as i32;
                let g = rgba[idx + 1] as i32;
                let b = rgba[idx + 2] as i32;

                let y = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(0, 255) as u8;
                y_plane[j * width + i] = y;

                if j % 2 == 0 && i % 2 == 0 {
                    let u = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
                    let v = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
                    let u_idx = (j / 2) * (width / 2) + (i / 2);
                    u_plane[u_idx] = u;
                    v_plane[u_idx] = v;
                }
            }
        }

        Self {
            y: y_plane,
            u: u_plane,
            v: v_plane,
            width,
            height,
        }
    }
}

impl YUVSource for RgbaToYuv420 {
    fn dimensions(&self) -> (usize, usize) { (self.width, self.height) }
    fn strides(&self) -> (usize, usize, usize) { (self.width, self.width / 2, self.width / 2) }
    fn y(&self) -> &[u8] { &self.y }
    fn u(&self) -> &[u8] { &self.u }
    fn v(&self) -> &[u8] { &self.v }
}

impl VideoStreamer {
    pub fn new(track: Arc<TrackLocalStaticSample>) -> Result<Self, String> {
        let mut config = EncoderConfig::new();
        config = config.sps_pps_strategy(openh264::encoder::SpsPpsStrategy::IncreasingId);
        config = config.profile(openh264::encoder::Profile::Baseline);
        config = config.level(openh264::encoder::Level::Level_3_1);
        let api = openh264::OpenH264API::from_source();
        let encoder = Encoder::with_api_config(api, config).map_err(|e| e.to_string())?;
        
        Ok(Self {
            track,
            encoder: Arc::new(Mutex::new(encoder)),
        })
    }

    pub async fn start_capture_loop(&self) {
        let monitors = Monitor::all().unwrap_or_default();
        if monitors.is_empty() {
            eprintln!("[Video] 無法找到顯示器");
            return;
        }
        let monitor = &monitors[0]; // 擷取主螢幕
        let encoder_arc = Arc::clone(&self.encoder);
        let track_arc = Arc::clone(&self.track);
        let monitor_clone = monitor.clone();

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
            let mut frame_count = 0;
            loop {
                let frame_time = std::time::Duration::from_millis(33); // 約 30fps
                
                // 擷取螢幕
                if let Ok(mut image) = monitor_clone.capture_image() {
                    let mut width = image.width() as usize;
                    let mut height = image.height() as usize;
                    
                    // 如果是 Retina 螢幕或 4K，降解析度到 1080p 以提升速度
                    if width > 1920 {
                        let scale = 1920.0 / width as f32;
                        let new_width = 1920;
                        let new_height = (height as f32 * scale) as u32;
                        image = image::imageops::resize(
                            &image,
                            new_width,
                            new_height,
                            image::imageops::FilterType::Nearest
                        );
                        width = image.width() as usize;
                        height = image.height() as usize;
                    }

                    // 為了確保 YUV 420 轉換正常，長寬必須是偶數
                    let adj_width = if width % 2 != 0 { width - 1 } else { width };
                    let adj_height = if height % 2 != 0 { height - 1 } else { height };

                    let yuv = RgbaToYuv420::new(image.as_raw(), adj_width, adj_height);
                    
                    // 在同步區塊中取得 encoder 並進行編碼
                    if let Ok(mut encoder_guard) = encoder_arc.try_lock() {
                        if frame_count % 30 == 0 {
                            encoder_guard.force_intra_frame();
                        }
                        frame_count += 1;
                        
                        match encoder_guard.encode(&yuv) {
                            Ok(encoded) => {
                                let data = encoded.to_vec();
                                if !data.is_empty() {
                                    if let Err(e) = tx.try_send(data) {
                                        // 可以在這裡加入除錯訊息，表示網路擁塞導致掉幀
                                    }
                                }
                            }
                            Err(e) => eprintln!("[Video] H.264 Encoding failed: {:?}", e),
                        }
                    }
                }

                let elapsed = tick.elapsed();
                if elapsed < frame_time {
                    std::thread::sleep(frame_time - elapsed);
                }
                tick = std::time::Instant::now();
            }
        });
    }
}
