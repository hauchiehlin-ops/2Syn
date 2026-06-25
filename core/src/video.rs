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

// =========================================================================
// 遠端游標合成（Cursor Compositing）
//
// - macOS：走零拷貝 IOSurface → 硬體編碼，無 CPU 端 RGBA 緩衝；改由
//   ScreenCaptureKit 以 with_shows_cursor(true) 直接合成「真實硬體游標」。
// - 非 macOS（xcap capture_image 取得 RGBA）：擷取通常不含游標，於編碼前
//   依「實際注入游標的比例座標」(input::get_global_cursor) 用下方函式手動疊圖。
//
// 兩者顯示用的座標都與點擊注入同源，所以所見即所點、零偏移，前端不再需要
// 推算合成游標（根治 cursor offset）。
// =========================================================================

/// 經典箭頭游標點陣圖：'#'=黑色描邊，'.'=白色填充，' '=透明。
/// 熱點(hotspot)位於左上角 (0,0)，對應 get_global_cursor 的比例座標。
/// （僅非 macOS 走此手動疊圖；macOS 由 ScreenCaptureKit 原生合成游標。）
const CURSOR_GLYPH: [&str; 18] = [
    "#",
    "##",
    "#.#",
    "#..#",
    "#...#",
    "#....#",
    "#.....#",
    "#......#",
    "#.......#",
    "#........#",
    "#.........#",
    "#......#####",
    "#...#..#",
    "#..# #..#",
    "#.#  #..#",
    "##   #..#",
    "     #..#",
    "     ####",
];

/// 將箭頭游標合成進 RGBA 影格。`cx`,`cy` 為游標熱點所在像素（影格座標）。
/// `scale` 放大倍率（Retina 影格較大，建議 2）。對 RGBA/BGRA 皆相容（僅用黑白）。
/// 註：游標策略改為客戶端本地預測後，被控端不再呼叫此函式，保留以利日後切換。
#[allow(dead_code)]
fn composite_cursor_rgba(bytes: &mut [u8], width: usize, height: usize, cx: i32, cy: i32, scale: i32) {
    let scale = scale.max(1);
    for (row, line) in CURSOR_GLYPH.iter().enumerate() {
        for (col, ch) in line.bytes().enumerate() {
            let (r, g, b) = match ch {
                b'#' => (0u8, 0u8, 0u8),
                b'.' => (255u8, 255u8, 255u8),
                _ => continue,
            };
            for sy in 0..scale {
                for sx in 0..scale {
                    let px = cx + col as i32 * scale + sx;
                    let py = cy + row as i32 * scale + sy;
                    if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 {
                        continue;
                    }
                    let idx = (py as usize * width + px as usize) * 4;
                    if idx + 3 < bytes.len() {
                        bytes[idx] = r;
                        bytes[idx + 1] = g;
                        bytes[idx + 2] = b;
                        bytes[idx + 3] = 255;
                    }
                }
            }
        }
    }
}

pub struct VideoStreamer {
    track: Arc<TrackLocalStaticSample>,
    encoder: Arc<Mutex<Box<dyn VideoHardwareEncoder + Send + Sync>>>,
    foveated_track: Option<Arc<TrackLocalStaticSample>>,
    foveated_encoder: Option<Arc<Mutex<Box<dyn VideoHardwareEncoder + Send + Sync>>>>,
}

impl VideoStreamer {
    pub fn new(track: Arc<TrackLocalStaticSample>, foveated_track: Option<Arc<TrackLocalStaticSample>>) -> Result<Self, String> {
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
        
        let mut foveated_encoder: Option<Arc<Mutex<Box<dyn VideoHardwareEncoder + Send + Sync>>>> = None;
        if foveated_track.is_some() {
            let mut fe = CaptureCodecFactory::create_encoder();
            let f_params = CodecParams {
                width: 400,
                height: 400,
                bitrate_kbps: 4000,
                fps: 60,
                codec_type: VideoCodecType::H264,
            };
            #[cfg(target_os = "macos")]
            {
                let init_res: Result<(), String> = objc::rc::autoreleasepool(|| {
                    fe.init(f_params).map_err(|e| format!("Failed to init foveated encoder: {:?}", e))
                });
                init_res?;
            }
            #[cfg(not(target_os = "macos"))]
            {
                fe.init(f_params).map_err(|e| format!("Failed to init foveated encoder: {:?}", e))?;
            }
            foveated_encoder = Some(Arc::new(Mutex::new(fe)));
        }

        Ok(Self {
            track,
            encoder: Arc::new(Mutex::new(encoder)),
            foveated_track,
            foveated_encoder,
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
            // 用「真實流逝時間」當每幀 duration，使 RTP 時間戳與墻鐘嚴格同步。
            // 寫死 33ms 會在實際幀率變動（尤其主動操作時）造成時間戳漂移，
            // 接收端誤判為串流落後而不斷膨脹 jitter buffer（實測可累積到數秒）。
            let mut last = std::time::Instant::now();
            let mut first = true;
            while let Some(data) = rx.recv().await {
                let now = std::time::Instant::now();
                let dur = if first {
                    first = false;
                    Duration::from_millis(16)
                } else {
                    now.duration_since(last)
                        .clamp(Duration::from_millis(1), Duration::from_millis(2000))
                };
                last = now;
                let sample = Sample {
                    data: data.into(),
                    duration: dur,
                    ..Default::default()
                };
                match tokio::time::timeout(std::time::Duration::from_millis(100), track_arc.write_sample(&sample)).await {
                    Ok(Err(e)) => eprintln!("[Video] 傳送視訊幀失敗: {}", e),
                    Err(_) => eprintln!("[Video] 傳送視訊幀逾時 (網路擁塞)"),
                    Ok(Ok(_)) => {}
                }
            }
        });

        // 第二軌道（感知優先）發送通道與任務
        let (foveated_tx, mut foveated_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(10);
        let foveated_track_arc = self.foveated_track.clone();
        tokio::spawn(async move {
            if let Some(f_track) = foveated_track_arc {
                let mut last = std::time::Instant::now();
                let mut first = true;
                while let Some(data) = foveated_rx.recv().await {
                    let now = std::time::Instant::now();
                    let dur = if first {
                        first = false;
                        Duration::from_millis(16)
                    } else {
                        now.duration_since(last)
                            .clamp(Duration::from_millis(1), Duration::from_millis(2000))
                    };
                    last = now;
                    let sample = Sample {
                        data: data.into(),
                        duration: dur,
                        ..Default::default()
                    };
                    let _ = tokio::time::timeout(std::time::Duration::from_millis(100), f_track.write_sample(&sample)).await;
                }
            }
        });

        let foveated_encoder_arc = self.foveated_encoder.clone();

        tokio::task::spawn_blocking(move || {
            let mut tick = std::time::Instant::now();
            let mut frame_count: u64 = 0;
            // 診斷：統計 host 端「實際編碼產出」的幀率，每 2 秒回報。
            let mut produced_frames: u32 = 0;
            let mut last_fps_log = std::time::Instant::now();
            // 三段計時診斷：等幀 / 編碼 / 送入發送佇列（阻塞代表發送端塞車）
            let mut acc_wait = std::time::Duration::ZERO;   // stream.next() 等待
            let mut acc_encode = std::time::Duration::ZERO; // 編碼耗時
            let mut acc_send = std::time::Duration::ZERO;   // blocking_send 阻塞
            let mut lock_fail: u32 = 0;                     // 編碼器鎖搶不到而跳幀次數
            
            // 初始化 Monitor
            let mut current_monitor_index = *monitor_rx.borrow();
            #[cfg(not(target_os = "macos"))]
            let mut monitors = Monitor::all().unwrap_or_default();
            #[cfg(not(target_os = "macos"))]
            let mut monitor_clone = if !monitors.is_empty() {
                let m = monitors[current_monitor_index.min(monitors.len() - 1)].clone();
                #[cfg(target_os = "windows")]
                {
                    if let Some((left, top, width, height)) = crate::input::get_monitor_bounds(current_monitor_index) {
                        crate::input::TARGET_MONITOR_X.store(left, std::sync::atomic::Ordering::Relaxed);
                        crate::input::TARGET_MONITOR_Y.store(top, std::sync::atomic::Ordering::Relaxed);
                        crate::input::TARGET_MONITOR_W.store(width as u32, std::sync::atomic::Ordering::Relaxed);
                        crate::input::TARGET_MONITOR_H.store(height as u32, std::sync::atomic::Ordering::Relaxed);
                    }
                }
                #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
                {
                    crate::input::TARGET_MONITOR_X.store(m.x(), std::sync::atomic::Ordering::Relaxed);
                    crate::input::TARGET_MONITOR_Y.store(m.y(), std::sync::atomic::Ordering::Relaxed);
                    crate::input::TARGET_MONITOR_W.store(m.width(), std::sync::atomic::Ordering::Relaxed);
                    crate::input::TARGET_MONITOR_H.store(m.height(), std::sync::atomic::Ordering::Relaxed);
                }
                Some(m)
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
                            let m = monitors[current_monitor_index.min(monitors.len() - 1)].clone();
                            #[cfg(target_os = "windows")]
                            {
                                if let Some((left, top, width, height)) = crate::input::get_monitor_bounds(current_monitor_index) {
                                    crate::input::TARGET_MONITOR_X.store(left, std::sync::atomic::Ordering::Relaxed);
                                    crate::input::TARGET_MONITOR_Y.store(top, std::sync::atomic::Ordering::Relaxed);
                                    crate::input::TARGET_MONITOR_W.store(width as u32, std::sync::atomic::Ordering::Relaxed);
                                    crate::input::TARGET_MONITOR_H.store(height as u32, std::sync::atomic::Ordering::Relaxed);
                                }
                            }
                            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
                            {
                                crate::input::TARGET_MONITOR_X.store(m.x(), std::sync::atomic::Ordering::Relaxed);
                                crate::input::TARGET_MONITOR_Y.store(m.y(), std::sync::atomic::Ordering::Relaxed);
                                crate::input::TARGET_MONITOR_W.store(m.width(), std::sync::atomic::Ordering::Relaxed);
                                crate::input::TARGET_MONITOR_H.store(m.height(), std::sync::atomic::Ordering::Relaxed);
                            }
                            monitor_clone = Some(m);
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
                                let frame = display.frame();
                                crate::input::TARGET_MONITOR_X.store(frame.x as i32, std::sync::atomic::Ordering::Relaxed);
                                crate::input::TARGET_MONITOR_Y.store(frame.y as i32, std::sync::atomic::Ordering::Relaxed);
                                crate::input::TARGET_MONITOR_W.store(frame.width as u32, std::sync::atomic::Ordering::Relaxed);
                                crate::input::TARGET_MONITOR_H.store(frame.height as u32, std::sync::atomic::Ordering::Relaxed);
                                
                                let filter = screencapturekit::stream::content_filter::SCContentFilter::builder().display(display).build();
                                let min_frame_interval = screencapturekit::cm::CMTime::new(1, target_fps as i32);
                                let config = screencapturekit::stream::configuration::SCStreamConfiguration::new()
                                    // 游標策略改為「客戶端本地預測繪製」（仿 Chrome 遠端桌面、零延遲跟手）：
                                    // 被控端不再把硬體游標烘焙進畫面，避免與前端本地游標形成雙游標。
                                    // 代價是失去原生游標外形，由前端統一畫箭頭。
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
                        let _t_wait = std::time::Instant::now();
                        let timeout_res = tokio::runtime::Handle::current().block_on(async {
                            tokio::time::timeout(std::time::Duration::from_millis(100), stream.next()).await
                        });
                        acc_wait += _t_wait.elapsed();

                        match timeout_res {
                            Ok(Some(sample)) => {
                                if let Some(pixel_buf) = sample.image_buffer() {
                                    if let Some(io_surface) = pixel_buf.io_surface() {
                                        let ptr = io_surface.as_ptr();
                                        if let Ok(mut encoder_guard) = encoder_arc.try_lock() {
                                            let _t_enc = std::time::Instant::now();
                                            let enc_res = encoder_guard.encode_frame_zero_copy(&crate::codec::FrameBuffer::IOSurface(ptr));
                                            acc_encode += _t_enc.elapsed();
                                            match enc_res {
                                                Ok(encoded_bytes) => {
                                                    produced_frames += 1;
                                                    let _t_send = std::time::Instant::now();
                                                    let _ = tx.blocking_send(encoded_bytes);
                                                    acc_send += _t_send.elapsed();
                                                }
                                                Err(e) => {
                                                    crate::debug_log!("VIDEO", "Zero-copy encode failed: {:?}", e);
                                                }
                                            }
                                        } else {
                                            lock_fail += 1;
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

                    // 游標策略改為「客戶端本地預測繪製」：被控端不再把游標烘焙進影格，
                    // 避免與前端本地游標形成雙游標（與 macOS shows_cursor(false) 一致）。


                    // 在同步區塊中取得 encoder 並進行編碼
                    if let Ok(mut encoder_guard) = encoder_arc.try_lock() {
                        if frame_count % 30 == 0 {
                            let _ = encoder_guard.force_intra_frame();
                        }
                        frame_count += 1;
                        
                        let encode_result = encoder_guard.encode_rgba_frame(&bytes, adj_width as u32, adj_height as u32);
                        
                        match encode_result {
                            Ok(encoded) => {
                                let data = encoded.to_vec();
                                if !data.is_empty() {
                                    produced_frames += 1;
                                    if let Err(_e) = tx.try_send(data) {}
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

                    // 處理第二軌道（Foveated 感知優先擷取）
                    if let Some(fe_arc) = &foveated_encoder_arc {
                        if let Ok(mut fe_guard) = fe_arc.try_lock() {
                            let (cx_ratio, cy_ratio) = crate::input::get_global_cursor();
                            let cx_px = (cx_ratio * width as f32) as i32;
                            let cy_px = (cy_ratio * height as f32) as i32;
                            let roi_w = 400;
                            let roi_h = 400;
                            
                            // 確保 ROI 不超出邊界
                            let mut start_x = (cx_px - roi_w / 2).max(0);
                            let mut start_y = (cy_px - roi_h / 2).max(0);
                            if start_x + roi_w > width as i32 { start_x = (width as i32 - roi_w).max(0); }
                            if start_y + roi_h > height as i32 { start_y = (height as i32 - roi_h).max(0); }
                            
                            let start_x = start_x as usize;
                            let start_y = start_y as usize;
                            let roi_w = roi_w as usize;
                            let roi_h = roi_h as usize;

                            if width >= roi_w && height >= roi_h {
                                let mut roi_bytes = vec![0u8; roi_w * roi_h * 4];
                                for y in 0..roi_h {
                                    let src_idx = ((start_y + y) * width + start_x) * 4;
                                    let dst_idx = y * roi_w * 4;
                                    roi_bytes[dst_idx..dst_idx + roi_w * 4].copy_from_slice(&bytes[src_idx..src_idx + roi_w * 4]);
                                }
                                
                                if frame_count % 30 == 0 {
                                    let _ = fe_guard.force_intra_frame();
                                }
                                
                                if let Ok(encoded) = fe_guard.encode_rgba_frame(&roi_bytes, roi_w as u32, roi_h as u32) {
                                    if !encoded.is_empty() {
                                        let _ = foveated_tx.try_send(encoded);
                                    }
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

                // 診斷：每 2 秒回報 host 端實際編碼產出幀率。經 status_tx 送到前端，
                // 以便直接顯示在 App 的「系統日誌」面板（eprintln 只進終端 stderr 看不到）。
                if last_fps_log.elapsed() >= std::time::Duration::from_secs(2) {
                    let secs = last_fps_log.elapsed().as_secs_f32();
                    let n = produced_frames.max(1) as f32;
                    let msg = format!(
                        "[Video][DIAG] host {:.1} fps（目標 {}）| 每幀均值 等幀 {:.0}ms 編碼 {:.0}ms 送出 {:.0}ms | 鎖搶不到跳幀 {}",
                        produced_frames as f32 / secs, target_fps,
                        acc_wait.as_millis() as f32 / n,
                        acc_encode.as_millis() as f32 / n,
                        acc_send.as_millis() as f32 / n,
                        lock_fail);
                    eprintln!("{}", msg);
                    if let Some(tx) = &status_tx { let _ = tx.send(msg); }
                    produced_frames = 0;
                    acc_wait = std::time::Duration::ZERO;
                    acc_encode = std::time::Duration::ZERO;
                    acc_send = std::time::Duration::ZERO;
                    lock_fail = 0;
                    last_fps_log = std::time::Instant::now();
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
