#![allow(non_snake_case)]
#![allow(unused_imports)]

use crate::CoreError;
use crate::codec::{CodecParams, VideoHardwareEncoder, VideoCodecType, FrameBuffer};
use std::sync::atomic::{AtomicI64, Ordering};
use rayon::prelude::*;

// 用於軟體轉換 RGBA 到 I420 的邏輯
struct RgbaToI420 {
    pub y: Vec<u8>,
    pub u: Vec<u8>,
    pub v: Vec<u8>,
    pub width: usize,
    pub height: usize,
}

impl openh264::formats::YUVSource for RgbaToI420 {
    fn dimensions(&self) -> (usize, usize) { (self.width, self.height) }
    fn strides(&self) -> (usize, usize, usize) { (self.width, self.width / 2, self.width / 2) }
    fn y(&self) -> &[u8] { &self.y }
    fn u(&self) -> &[u8] { &self.u }
    fn v(&self) -> &[u8] { &self.v }
}

impl RgbaToI420 {
    fn new(rgba: &[u8], src_width: usize, src_height: usize, target_width: usize, target_height: usize) -> Self {
        let aligned_w = target_width & !1;
        let aligned_h = target_height & !1;
        let mut y_plane = vec![0u8; aligned_w * aligned_h];
        let mut u_plane = vec![0u8; (aligned_w / 2) * (aligned_h / 2)];
        let mut v_plane = vec![0u8; (aligned_w / 2) * (aligned_h / 2)];

        let scale_x = src_width as f32 / aligned_w as f32;
        let scale_y = src_height as f32 / aligned_h as f32;

        y_plane.par_chunks_exact_mut(aligned_w).enumerate().for_each(|(j, y_row)| {
            let src_j = ((j as f32 * scale_y) as usize).min(src_height - 1);
            for i in 0..aligned_w {
                let src_i = ((i as f32 * scale_x) as usize).min(src_width - 1);
                let idx = (src_j * src_width + src_i) * 4;
                let r = rgba[idx] as i32;
                let g = rgba[idx + 1] as i32;
                let b = rgba[idx + 2] as i32;
                y_row[i] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(0, 255) as u8;
            }
        });

        let uv_width = aligned_w / 2;
        u_plane.par_chunks_exact_mut(uv_width).zip(v_plane.par_chunks_exact_mut(uv_width)).enumerate().for_each(|(u_j, (u_row, v_row))| {
            let j = u_j * 2;
            let src_j = ((j as f32 * scale_y) as usize).min(src_height - 1);
            for u_i in 0..uv_width {
                let i = u_i * 2;
                let src_i = ((i as f32 * scale_x) as usize).min(src_width - 1);
                let idx = (src_j * src_width + src_i) * 4;
                let r = rgba[idx] as i32;
                let g = rgba[idx + 1] as i32;
                let b = rgba[idx + 2] as i32;
                u_row[u_i] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
                v_row[u_i] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
            }
        });

        Self { y: y_plane, u: u_plane, v: v_plane, width: aligned_w, height: aligned_h }
    }
}

pub struct WindowsHardwareEncoder {
    params: Option<CodecParams>,
    frame_count: i64,
    #[cfg(target_os = "windows")]
    encoder: Option<openh264::encoder::Encoder>,
}

impl Default for WindowsHardwareEncoder {
    fn default() -> Self { Self::new() }
}

impl WindowsHardwareEncoder {
    pub fn new() -> Self {
        Self { 
            params: None, 
            frame_count: 0,
            #[cfg(target_os = "windows")]
            encoder: None,
        }
    }

    #[cfg(target_os = "windows")]
    fn setup_encoder(&mut self, width: u32, height: u32, _fps: u32, _bitrate_kbps: u32) -> Result<(), CoreError> {
        use openh264::encoder::{Encoder, EncoderConfig};
        let config = EncoderConfig::new(width, height);
        let encoder = Encoder::with_config(config)
            .map_err(|e| CoreError::HardwareCodecError(format!("Failed to create openh264 encoder: {:?}", e)))?;
        self.encoder = Some(encoder);
        Ok(())
    }
}

unsafe impl Send for WindowsHardwareEncoder {}
unsafe impl Sync for WindowsHardwareEncoder {}

impl VideoHardwareEncoder for WindowsHardwareEncoder {
    fn init(&mut self, params: CodecParams) -> Result<(), CoreError> {
        self.params = Some(params.clone());
        #[cfg(target_os = "windows")]
        self.setup_encoder(params.width, params.height, params.fps, params.bitrate_kbps)?;
        Ok(())
    }

    fn reconfigure(&mut self, bitrate_kbps: u32, fps: u32, target_width: u32, target_height: u32) -> Result<(), CoreError> {
        if let Some(ref mut p) = self.params {
            p.bitrate_kbps = bitrate_kbps;
            p.fps = fps;
            p.width = target_width;
            p.height = target_height;
            #[cfg(target_os = "windows")]
            self.setup_encoder(target_width, target_height, fps, bitrate_kbps)?;
            Ok(())
        } else {
            Err(CoreError::HardwareCodecError("編碼器未初始化".to_string()))
        }
    }

    fn force_intra_frame(&mut self) -> Result<(), CoreError> {
        Ok(())
    }

    fn encode_rgba_frame(&mut self, rgba_data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, CoreError> {
        #[cfg(target_os = "windows")]
        {
            let target_w = self.params.as_ref().map(|p| p.width).unwrap_or(width);
            let target_h = self.params.as_ref().map(|p| p.height).unwrap_or(height);

            if self.encoder.is_none() {
                self.setup_encoder(target_w, target_h, 30, 2000)?;
            }
            
            if let Some(encoder) = &mut self.encoder {
                let i420 = RgbaToI420::new(rgba_data, width as usize, height as usize, target_w as usize, target_h as usize);
                match encoder.encode(&i420) {
                    Ok(stream) => {
                        self.frame_count += 1;
                        return Ok(stream.to_vec());
                    }
                    Err(e) => {
                        return Err(CoreError::HardwareCodecError(format!("Encode failed: {:?}", e)));
                    }
                }
            }
            
            self.frame_count += 1;
            Ok(vec![0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x0a, 0xf8, 0x41, 0xa2])
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = rgba_data;
            self.frame_count += 1;
            Ok(vec![0x00, 0x00, 0x00, 0x01, 0x67])
        }
    }

    fn encode_frame_zero_copy(&mut self, _gpu_texture: &FrameBuffer) -> Result<Vec<u8>, CoreError> {
        Err(CoreError::HardwareCodecError("尚未支援 Windows 零拷貝".to_string()))
    }
}
