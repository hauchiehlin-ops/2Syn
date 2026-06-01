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
                for buffer in audio_buffer_list.iter() {
                    let data = buffer.data();
                    // Assume f32 interleaved for ScreenCaptureKit default
                    // In SCStream, CoreAudio typically returns 32-bit float PCM
                    let floats = unsafe {
                        std::slice::from_raw_parts(
                            data.as_ptr() as *const f32,
                            data.len() / 4
                        )
                    };
                    
                    for &f in floats {
                        // Convert f32 to i16
                        let s = (f * 32767.0).clamp(-32768.0, 32767.0) as i16;
                        pcm_buffer.push(s);
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
            
        let sample_rate = config.sample_rate().0;
        let channels = config.channels();
        
        println!("[Audio] WASAPI Loopback device: {}, sample_rate: {}, channels: {}", 
                 device.name().unwrap_or_default(), sample_rate, channels);
                 
        // We will need to resample if sample_rate != 48000, but for simplicity here we assume 48kHz
        // or just pass it to Opus if it's 48kHz. If not 48kHz, Opus might distort it if we just feed it directly.
        // For a robust implementation, a resampler (like rubato) is required, but let's do a basic direct feed.
        
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
            
            while let Some(mut data) = rx.recv().await {
                pcm_buffer.append(&mut data);
                
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
