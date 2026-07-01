use std::sync::Arc;
use tokio::sync::Mutex;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::media::Sample;
use std::time::Duration;

#[cfg(target_os = "macos")]
use screencapturekit::stream::configuration::SCStreamConfiguration;

#[cfg(target_os = "windows")]
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use opus::{Encoder, Channels, Application};

pub struct AudioStreamer {
    track: Arc<TrackLocalStaticSample>,
    encoder: Arc<Mutex<Encoder>>,
}

impl AudioStreamer {
    pub fn new(track: Arc<TrackLocalStaticSample>) -> Result<Self, String> {
        let encoder = Encoder::new(48000, Channels::Stereo, Application::Audio)
            .map_err(|e| format!("Failed to create Opus encoder: {:?}", e))?;
            
        Ok(Self {
            track,
            encoder: Arc::new(Mutex::new(encoder)),
        })
    }

    pub async fn start(&self, active_webrtc: Arc<std::sync::atomic::AtomicBool>) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            self.start_macos(active_webrtc).await
        }
        
        #[cfg(target_os = "windows")]
        {
            self.start_windows().await
        }
        
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("Audio capture is not supported on this platform".to_string())
        }
    }

    #[cfg(target_os = "macos")]
    async fn start_macos(&self, active_webrtc: Arc<std::sync::atomic::AtomicBool>) -> Result<(), String> {
        use screencapturekit::async_api::{AsyncSCShareableContent, AsyncSCStream};
        use screencapturekit::stream::content_filter::SCContentFilter;
        use screencapturekit::stream::output_type::SCStreamOutputType;
        use std::sync::atomic::Ordering;

        println!("[Audio] Starting macOS audio capture via ScreenCaptureKit...");
        
        let content = AsyncSCShareableContent::get()
            .await
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
            
        let displays = content.displays();
        let display = displays.first().ok_or("No displays found")?;
        
        let filter = SCContentFilter::builder()
            .display(display)
            .build();
            
        let mut config = SCStreamConfiguration::new();
        config.set_captures_audio(true);
        config.set_excludes_current_process_audio(true); // macOS 14.0+ feature, but let's try
        
        // Actually we might need builder pattern depending on SCStreamConfiguration
        let config = SCStreamConfiguration::new()
            .with_captures_audio(true)
            .with_sample_rate(48000)
            .with_channel_count(2);
            
        let stream = AsyncSCStream::new(&filter, &config, 100, SCStreamOutputType::Audio);
        
        stream.start_capture().map_err(|e| format!("Failed to start stream: {}", e))?;
        
        println!("[Audio] macOS audio capture loop started.");
        
        let mut pcm_buffer: Vec<i16> = Vec::with_capacity(4096);
        let frame_size = 960; // 20ms at 48kHz
        let samples_per_frame = frame_size * 2; // Stereo
        
        let mut sample_count: u64 = 0;
        while let Some(sample) = stream.next().await {
            sample_count += 1;
            if sample_count % 100 == 1 {
                crate::debug_log!("AUDIO", "macOS audio sample_count={} active={}", sample_count, active_webrtc.load(Ordering::SeqCst));
            }
            // 若連線不活躍，則直接丟棄音訊，防止 ScreenCaptureKit 內部緩衝區積壓導致記憶體洩漏與 CPU 暴衝
            if !active_webrtc.load(Ordering::SeqCst) {
                continue;
            }

            if let Some(audio_buffer_list) = sample.audio_buffer_list() {
                // ScreenCaptureKit 預設輸出 planar（非交錯）f32：每個聲道一個獨立 buffer。
                // Opus 需要 interleaved 立體聲 [L,R,L,R,...]，必須手動交錯，
                // 否則整段 L 接整段 R 會造成音訊完全失真。
                let as_f32 = |data: &[u8]| unsafe {
                    std::slice::from_raw_parts(data.as_ptr() as *const f32, data.len() / 4)
                };
                let to_i16 = |f: f32| (f * 32767.0).clamp(-32768.0, 32767.0) as i16;

                let num_buffers = audio_buffer_list.num_buffers();
                if num_buffers >= 2 {
                    // Planar：取前兩個聲道交錯為立體聲
                    let ch_l = audio_buffer_list.get(0).map(|b| as_f32(b.data())).unwrap_or(&[]);
                    let ch_r = audio_buffer_list.get(1).map(|b| as_f32(b.data())).unwrap_or(&[]);
                    let frames = ch_l.len().min(ch_r.len());
                    for i in 0..frames {
                        pcm_buffer.push(to_i16(ch_l[i]));
                        pcm_buffer.push(to_i16(ch_r[i]));
                    }
                } else if let Some(buffer) = audio_buffer_list.get(0) {
                    let floats = as_f32(buffer.data());
                    if buffer.number_channels == 1 {
                        // Mono：複製為左右聲道
                        for &f in floats {
                            let s = to_i16(f);
                            pcm_buffer.push(s);
                            pcm_buffer.push(s);
                        }
                    } else {
                        // 單 buffer 多聲道 = interleaved，直接轉換
                        for &f in floats {
                            pcm_buffer.push(to_i16(f));
                        }
                    }
                }
            }
            
            // Encode if we have enough samples
            while pcm_buffer.len() >= samples_per_frame {
                let chunk: Vec<i16> = pcm_buffer.drain(..samples_per_frame).collect();
                let mut encoder = self.encoder.lock().await;
                if let Ok(opus_data) = encoder.encode_vec(&chunk, 4000) {
                    let sample = Sample {
                        data: opus_data.into(),
                        duration: Duration::from_millis(20),
                        ..Default::default()
                    };
                    let _ = self.track.write_sample(&sample).await;
                }
            }
        }
        println!("[Audio] ScreenCaptureKit stream ended, exiting audio loop.");
        Ok(())
    }

    #[cfg(target_os = "windows")]
    async fn start_windows(&self) -> Result<(), String> {
        println!("[Audio] Starting Windows audio capture via WASAPI Loopback...");
        
        let host = cpal::host_from_id(cpal::HostId::Wasapi)
            .map_err(|e| format!("WASAPI not available: {}", e))?;
            
        let device = host.default_output_device()
            .ok_or("No default output device available for WASAPI loopback")?;
            
        let config = device.default_output_config()
            .map_err(|e| format!("Failed to get default output config: {}", e))?;
            
        let sample_rate: u32 = config.sample_rate().into();
        let channels = config.channels();
        
        println!("[Audio] WASAPI Loopback device: {}, sample_rate: {}, channels: {}", 
                 device.name().unwrap_or_default(), sample_rate, channels);
                 
        let encoder_arc = Arc::clone(&self.encoder);
        let track_arc = Arc::clone(&self.track);
        
        let mut pcm_buffer: Vec<i16> = Vec::with_capacity(4096);
        let frame_size = 960; // 20ms at 48kHz
        let samples_per_frame = frame_size * 2; // Stereo
        
        let err_fn = |err| eprintln!("[Audio] an error occurred on stream: {}", err);
        
        // Use a channel to move data out of the CPAL thread to an async Tokio thread
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<i16>>();
        
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &_| {
                        let mut chunk = Vec::with_capacity(data.len());
                        for &f in data {
                            chunk.push((f * 32767.0).clamp(-32768.0, 32767.0) as i16);
                        }
                        let _ = tx.send(chunk);
                    },
                    err_fn,
                    None,
                )
            },
            cpal::SampleFormat::I16 => {
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &_| {
                        let _ = tx.send(data.to_vec());
                    },
                    err_fn,
                    None,
                )
            },
            _ => return Err("Unsupported sample format".to_string()),
        }.map_err(|e| format!("Failed to build input stream: {}", e))?;
        
        stream.play().map_err(|e| format!("Failed to play stream: {}", e))?;
        
        // Spawn async loop to encode
        tokio::spawn(async move {
            // Keep stream alive
            let _stream = stream;

            // 裝置格式 → Opus 要求的 48kHz interleaved 立體聲
            let src_rate = sample_rate as f64;
            let ch = channels.max(1) as usize;
            let mut resample_pos: f64 = 0.0;
            let mut prev_frame: (i16, i16) = (0, 0);

            while let Some(data) = rx.recv().await {
                // 1) 聲道正規化為立體聲 frame（mono 複製、多聲道取前兩軌）
                let mut stereo: Vec<(i16, i16)> = Vec::with_capacity(data.len() / ch + 1);
                if ch == 1 {
                    for &s in &data {
                        stereo.push((s, s));
                    }
                } else {
                    for frame in data.chunks_exact(ch) {
                        stereo.push((frame[0], frame[1]));
                    }
                }

                // 2) 取樣率轉換至 48kHz（線性內插；44.1kHz 等裝置直接餵 Opus 會失真）
                if (src_rate - 48000.0).abs() < 1.0 {
                    for (l, r) in stereo {
                        pcm_buffer.push(l);
                        pcm_buffer.push(r);
                    }
                } else {
                    let step = src_rate / 48000.0;
                    // 前置上一塊的最後一個 frame，讓內插跨資料塊連續
                    let mut frames = Vec::with_capacity(stereo.len() + 1);
                    frames.push(prev_frame);
                    frames.extend_from_slice(&stereo);
                    let mut pos = resample_pos;
                    while pos + 1.0 < frames.len() as f64 {
                        let idx = pos as usize;
                        let frac = pos - idx as f64;
                        let (l0, r0) = frames[idx];
                        let (l1, r1) = frames[idx + 1];
                        pcm_buffer.push((l0 as f64 + (l1 as f64 - l0 as f64) * frac) as i16);
                        pcm_buffer.push((r0 as f64 + (r1 as f64 - r0 as f64) * frac) as i16);
                        pos += step;
                    }
                    resample_pos = pos - (frames.len() as f64 - 1.0);
                    if let Some(&last) = frames.last() {
                        prev_frame = last;
                    }
                }

                while pcm_buffer.len() >= samples_per_frame {
                    let chunk: Vec<i16> = pcm_buffer.drain(..samples_per_frame).collect();
                    let mut encoder = encoder_arc.lock().await;
                    if let Ok(opus_data) = encoder.encode_vec(&chunk, 4000) {
                        let sample = Sample {
                            data: opus_data.into(),
                            duration: Duration::from_millis(20),
                            ..Default::default()
                        };
                        let _ = track_arc.write_sample(&sample).await;
                    }
                }
            }
        });
        
        Ok(())
    }
}
