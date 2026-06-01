use crate::CoreError;

#[cfg(any(target_os = "macos", target_os = "ios"))]
use apple_cf::iosurface::IOSurface;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use videotoolbox::compression::CompressionSession;

/// 視訊編碼格式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodecType {
    H264,
    H265,
    Av1,
}

/// 編解碼器共用配置
#[derive(Debug, Clone)]
pub struct CodecParams {
    pub width: u32,
    pub height: u32,
    pub bitrate_kbps: u32,
    pub fps: u32,
    pub codec_type: VideoCodecType,
}

/// 擷取到的畫面影格資料結構，支援 GPU 紋理與系統記憶體雙通道
pub enum FrameBuffer {
    /// 系統 CPU 記憶體緩衝區
    CpuMemory(Vec<u8>),
    
    /// Windows D3D11 顯卡紋理指標 (零拷貝專用)
    #[cfg(target_os = "windows")]
    D3D11Texture(*mut std::ffi::c_void),
    
    /// macOS/iOS CVPixelBuffer 指標 (零拷貝專用)
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    CVPixelBuffer(*mut std::ffi::c_void),

    /// macOS/iOS IOSurface 指標 (零拷貝專用)
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    IOSurface(*mut std::ffi::c_void),
}

/// 跨平台硬體畫面擷取 (Screen Capture) 介面
pub trait ScreenCapturer {
    /// 初始化擷取管線
    fn init(&mut self) -> Result<(), CoreError>;

    /// 獲取下一幀畫面
    fn acquire_next_frame(&mut self) -> Result<FrameBuffer, CoreError>;
}

/// 跨平台硬體視訊編碼器介面
pub trait VideoHardwareEncoder: Send + Sync {
    /// 初始化編碼器
    fn init(&mut self, params: CodecParams) -> Result<(), CoreError>;

    /// 動態調整編碼位元率與畫面更新率與解析度
    fn reconfigure(&mut self, bitrate_kbps: u32, fps: u32, width: u32, height: u32) -> Result<(), CoreError>;

    /// 強制輸出 I-Frame (IDR 關鍵影格)
    fn force_intra_frame(&mut self) -> Result<(), CoreError>;

    /// 常規編碼：將系統 CPU 記憶體影像(RGBA)進行編碼，交由硬體進行色彩轉換
    fn encode_rgba_frame(&mut self, rgba_frame: &[u8], width: u32, height: u32) -> Result<Vec<u8>, CoreError>;

    /// 零拷貝編碼：直接傳遞 GPU 紋理在顯存中壓縮，跳過 CPU 記憶體複製以達成極致低延遲
    fn encode_frame_zero_copy(&mut self, gpu_texture: &FrameBuffer) -> Result<Vec<u8>, CoreError>;
}

// =========================================================================
// Windows 平台 DXGI Desktop Duplication 畫面擷取與 NVENC 零拷貝編碼
// =========================================================================

#[cfg(target_os = "windows")]
pub struct WindowsDxgiCapturer {
    device: *mut std::ffi::c_void,
    output_duplication: *mut std::ffi::c_void,
}

#[cfg(target_os = "windows")]
impl WindowsDxgiCapturer {
    pub fn new() -> Self {
        Self {
            device: std::ptr::null_mut(),
            output_duplication: std::ptr::null_mut(),
        }
    }
}

#[cfg(target_os = "windows")]
impl ScreenCapturer for WindowsDxgiCapturer {
    fn init(&mut self) -> Result<(), CoreError> {
        // TODO: 真實 DXGI Desktop Duplication 整合需要 windows crate 或 DirectX SDK binding。
        // 目前以 stub 形式佔位，展示完整管線架構。
        // 實際整合步驟：
        //   1. D3D11CreateDevice → 建立 ID3D11Device
        //   2. QueryInterface → 取得 IDXGIDevice → IDXGIAdapter → IDXGIOutput
        //   3. IDXGIOutput1::DuplicateOutput → 建立 IDXGIOutputDuplication
        //   4. IDXGIOutputDuplication::AcquireNextFrame → 逐幀取得 ID3D11Texture2D
        self.device = std::ptr::null_mut();
        self.output_duplication = std::ptr::null_mut();
        Ok(())
    }

    fn acquire_next_frame(&mut self) -> Result<FrameBuffer, CoreError> {
        // Stub：回傳空指標佔位，真實實作從 AcquireNextFrame 取得 D3D11 Texture2D 指標
        Ok(FrameBuffer::D3D11Texture(self.device))
    }
}

// =========================================================================
// macOS 平台 ScreenCaptureKit 畫面擷取與 VideoToolbox 零拷貝編碼
// =========================================================================

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub struct AppleScreenCapturer {
    /// SCStream 實例指標，預留給將來 ScreenCaptureKit FFI 整合使用
    #[allow(dead_code)]
    stream: *mut std::ffi::c_void,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl Default for AppleScreenCapturer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl AppleScreenCapturer {
    pub fn new() -> Self {
        Self { stream: std::ptr::null_mut() }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl ScreenCapturer for AppleScreenCapturer {
    fn init(&mut self) -> Result<(), CoreError> {
        // macOS SCShareableContent / SCStream 畫面擷取初始化
        // 1. 呼叫 SCShareableContent.getShareableContentWithCompletionHandler 獲取可用螢幕
        // 2. 建立 SCStreamConfiguration 配置寬高與影格率
        // 3. 實作 SCStreamOutput protocol 接收影格回呼
        Ok(())
    }

    fn acquire_next_frame(&mut self) -> Result<FrameBuffer, CoreError> {
        // 1. 在 SCStreamOutput 的 stream:didOutputSampleBuffer 回呼中獲取 CMSampleBuffer
        // 2. 使用 CMSampleBufferGetImageBuffer 提取 CVPixelBuffer 紋理
        // 3. 回傳 FrameBuffer::CVPixelBuffer，以直接傳遞至 VideoToolbox 編碼
        Ok(FrameBuffer::CVPixelBuffer(std::ptr::null_mut())) // 模擬返回
    }
}

// =========================================================================
// 零拷貝硬體加速編碼器實現（Windows & macOS）
// =========================================================================

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub struct AppleHardwareEncoder {
    params: Option<CodecParams>,
    session: Option<CompressionSession>,
    frame_count: i64,
    surface: Option<IOSurface>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl Default for AppleHardwareEncoder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl AppleHardwareEncoder {
    pub fn new() -> Self { Self { params: None, session: None, frame_count: 0, surface: None } }
    
    fn recreate_session(&mut self, width: u32, height: u32) -> Result<(), CoreError> {
        let codec = match self.params.as_ref().map(|p| p.codec_type).unwrap_or(VideoCodecType::H264) {
            VideoCodecType::H264 => videotoolbox::Codec::H264,
            VideoCodecType::H265 => videotoolbox::Codec::HEVC,
            _ => videotoolbox::Codec::H264, // 預設使用 H.264
        };
        let builder = CompressionSession::builder(width as i32, height as i32, codec)
            .with_max_keyframe_interval(30); // 每秒強制產生一個關鍵影格，避免網路掉包導致永久卡死
        if let Ok(session) = builder.build() {
            // 可在此進一步設定 bit rate (例如 session.set_average_bitrate(...))
            self.session = Some(session);
            // 同時快取並建立對應寬高之 IOSurface 緩衝區
            // 注意：bytes_per_row 必須設為 0 讓 macOS 自動選擇最佳對齊長度（通常是 64 或 256 的倍數）
            // 否則如果傳入 width*4，在非對齊的解析度下，VideoToolbox 讀取時會發生 GPU OutOfBounds，導致整台 Mac 死機！
            self.surface = IOSurface::create(
                width as usize,
                height as usize,
                u32::from_be_bytes(*b"BGRA"),
                0
            );
            Ok(())
        } else {
            Err(CoreError::HardwareCodecError("建立 VTCompressionSession 失敗".to_string()))
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl VideoHardwareEncoder for AppleHardwareEncoder {
    fn init(&mut self, params: CodecParams) -> Result<(), CoreError> {
        let w = params.width;
        let h = params.height;
        self.params = Some(params);
        self.recreate_session(w, h)?;
        Ok(())
    }

    fn reconfigure(&mut self, bitrate_kbps: u32, fps: u32, target_width: u32, target_height: u32) -> Result<(), CoreError> {
        if let Some(ref mut p) = self.params {
            p.bitrate_kbps = bitrate_kbps;
            p.fps = fps;
            p.width = target_width;
            p.height = target_height;
            // 重新建立 Session 來套用新參數 (因 videotoolbox-rs 缺乏動態 set_property 的 safe 封裝)
            self.recreate_session(target_width, target_height)?;
            Ok(())
        } else {
            Err(CoreError::HardwareCodecError("編碼器未初始化".to_string()))
        }
    }

    fn force_intra_frame(&mut self) -> Result<(), CoreError> {
        // VideoToolbox 提供強制 Keyframe 的屬性
        Ok(())
    }

    fn encode_rgba_frame(&mut self, rgba_frame: &[u8], width: u32, height: u32) -> Result<Vec<u8>, CoreError> {
        let (encode_w, encode_h) = if let Some(ref p) = self.params {
            (p.width, p.height)
        } else {
            (width, height)
        };
        crate::debug_log!("CODEC", "encode_rgba_frame start input_w={} input_h={} encode_w={} encode_h={}", width, height, encode_w, encode_h);
        
        if let Some(ref session) = self.session {
            // 取得快取的 IOSurface
            let surface = self.surface.as_ref().ok_or_else(|| {
                CoreError::HardwareCodecError("IOSurface 緩衝區不存在".into())
            })?;
            
            if let Ok(mut guard) = surface.lock_read_write() {
                let dest_bpr = surface.bytes_per_row();
                if let Some(dest) = guard.as_slice_mut() {
                    if width == encode_w && height == encode_h {
                        // 不能直接 flat copy，必須根據 dest_bpr 逐行拷貝以避開對齊的 Padding
                        let src_bpr = width as usize * 4;
                        for row in 0..height as usize {
                            let dest_row_start = row * dest_bpr;
                            let src_row_start = row * src_bpr;
                            let row_len = src_bpr.min(dest_bpr);
                            if src_row_start + row_len <= rgba_frame.len() && dest_row_start + row_len <= dest.len() {
                                dest[dest_row_start..dest_row_start + row_len].copy_from_slice(&rgba_frame[src_row_start..src_row_start + row_len]);
                            }
                        }
                    } else {
                        // 零記憶體分配 Nearest 縮放
                        let scale_x = width as f32 / encode_w as f32;
                        let scale_y = height as f32 / encode_h as f32;
                        
                        for row in 0..encode_h {
                            let input_row = ((row as f32 * scale_y) as u32).min(height - 1);
                            let dest_row_offset = row as usize * dest_bpr; // 使用正確的 destination row stride
                            let src_row_offset = input_row as usize * width as usize * 4;
                            
                            for col in 0..encode_w {
                                let input_col = ((col as f32 * scale_x) as u32).min(width - 1);
                                  let dest_offset = dest_row_offset + col as usize * 4;
                                  let src_offset = src_row_offset + input_col as usize * 4;
                                  
                                  if src_offset + 3 < rgba_frame.len() && dest_offset + 3 < dest.len() {
                                      dest[dest_offset] = rgba_frame[src_offset];         // B
                                      dest[dest_offset + 1] = rgba_frame[src_offset + 1]; // G
                                      dest[dest_offset + 2] = rgba_frame[src_offset + 2]; // R
                                      dest[dest_offset + 3] = rgba_frame[src_offset + 3]; // A
                                  }
                            }
                        }
                    }
                }
            }
            
            crate::debug_log!("CODEC", "Before VTCompressionSession::encode frame_count={}", self.frame_count);
            let encode_res = session.encode(surface, (self.frame_count, 30));
            crate::debug_log!("CODEC", "After VTCompressionSession::encode result={}", encode_res.is_ok());
            
            match encode_res {
                Ok(encoded_frame) => {
                    self.frame_count += 1;
                    Ok(encoded_frame.data)
                }
                Err(e) => Err(CoreError::HardwareCodecError(format!("編碼失敗: {:?}", e))),
            }
        } else {
            Err(CoreError::HardwareCodecError("VTCompressionSession 不存在".to_string()))
        }
    }

    fn encode_frame_zero_copy(&mut self, gpu_texture: &FrameBuffer) -> Result<Vec<u8>, CoreError> {
        if let FrameBuffer::IOSurface(iosurface_ptr) = gpu_texture {
            if let Some(ref session) = self.session {
                // 將指標轉換回 apple_cf::iosurface::IOSurface
                // 因為我們借用這個指標，所以使用 ManuallyDrop 避免提早被釋放 (減少 ref count)
                if let Some(surface_val) = apple_cf::iosurface::IOSurface::from_raw(*iosurface_ptr) {
                    let surface_wrapper = std::mem::ManuallyDrop::new(surface_val);
                    
                    crate::debug_log!("CODEC", "Before VTCompressionSession::encode (Zero-Copy)");
                    let encode_res = session.encode(&surface_wrapper, (self.frame_count, 30));
                    crate::debug_log!("CODEC", "After VTCompressionSession::encode (Zero-Copy) result={}", encode_res.is_ok());
                    
                    match encode_res {
                        Ok(encoded_frame) => {
                            self.frame_count += 1;
                            
                            // 轉換 AVCC 至 Annex B，並在 Keyframe 插入 SPS/PPS
                            let mut out = Vec::with_capacity(encoded_frame.data.len() + 100);
                            let mut is_keyframe = false;
                            
                            let mut offset = 0;
                            while offset + 4 <= encoded_frame.data.len() {
                                let nalu_len = u32::from_be_bytes(
                                    encoded_frame.data[offset..offset + 4].try_into().unwrap()
                                ) as usize;
                                
                                if offset + 4 + nalu_len > encoded_frame.data.len() {
                                    break;
                                }
                                
                                let nalu_type = encoded_frame.data[offset + 4] & 0x1F;
                                if nalu_type == 5 {
                                    is_keyframe = true;
                                }
                                
                                out.extend_from_slice(&[0, 0, 0, 1]);
                                out.extend_from_slice(&encoded_frame.data[offset + 4 .. offset + 4 + nalu_len]);
                                
                                offset += 4 + nalu_len;
                            }
                            
                            if is_keyframe {
                                if let Some(cm_buf) = encoded_frame.cm_sample_buffer() {
                                    if let Some(format_desc) = cm_buf.format_description() {
                                        extern "C" {
                                            fn CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                                                videoDesc: *const std::ffi::c_void,
                                                parameterSetIndex: usize,
                                                parameterSetPointerOut: *mut *const u8,
                                                parameterSetSizeOut: *mut usize,
                                                parameterSetCountOut: *mut usize,
                                                NALUnitHeaderLengthOut: *mut std::ffi::c_int,
                                            ) -> i32;
                                        }
                                        
                                        let mut final_out = Vec::with_capacity(out.len() + 100);
                                        let format_ptr = format_desc.as_ptr() as *const std::ffi::c_void;
                                        let mut count = 0;
                                        let mut dummy_len = 0;
                                        
                                        for i in 0..2 { // 0: SPS, 1: PPS
                                            let mut ptr: *const u8 = std::ptr::null();
                                            let mut size: usize = 0;
                                            let status = unsafe {
                                                CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                                                    format_ptr, i, &mut ptr, &mut size, &mut count, &mut dummy_len
                                                )
                                            };
                                            if status == 0 && !ptr.is_null() && size > 0 {
                                                final_out.extend_from_slice(&[0, 0, 0, 1]);
                                                final_out.extend_from_slice(unsafe { std::slice::from_raw_parts(ptr, size) });
                                            }
                                        }
                                        final_out.extend_from_slice(&out);
                                        return Ok(final_out);
                                    }
                                }
                            }
                            
                            Ok(out)
                        }
                        Err(e) => Err(CoreError::HardwareCodecError(format!("零拷貝編碼失敗: {:?}", e))),
                    }
                } else {
                    Err(CoreError::HardwareCodecError("無效的 IOSurface 指標".to_string()))
                }
            } else {
                Err(CoreError::HardwareCodecError("VTCompressionSession 不存在".to_string()))
            }
        } else {
            Err(CoreError::HardwareCodecError("不支援的編碼紋理類型".to_string()))
        }
    }
}

// =========================================================================
// 畫面擷取與硬體編碼器工廠模式
// =========================================================================

pub struct CaptureCodecFactory;

impl CaptureCodecFactory {
    #[cfg(target_os = "windows")]
    pub fn create_capturer() -> Box<dyn ScreenCapturer> {
        Box::new(WindowsDxgiCapturer::new())
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub fn create_capturer() -> Box<dyn ScreenCapturer> {
        Box::new(AppleScreenCapturer::new())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios")))]
    pub fn create_capturer() -> Box<dyn ScreenCapturer> {
        struct DummyCapturer;
        impl ScreenCapturer for DummyCapturer {
            fn init(&mut self) -> Result<(), CoreError> { Ok(()) }
            fn acquire_next_frame(&mut self) -> Result<FrameBuffer, CoreError> {
                Ok(FrameBuffer::CpuMemory(vec![]))
            }
        }
        Box::new(DummyCapturer)
    }

    #[cfg(target_os = "windows")]
    pub fn create_encoder() -> Box<dyn VideoHardwareEncoder + Send + Sync> {
        Box::new(crate::mft_encoder::WindowsHardwareEncoder::new())
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub fn create_encoder() -> Box<dyn VideoHardwareEncoder> {
        Box::new(AppleHardwareEncoder::new())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios")))]
    pub fn create_encoder() -> Box<dyn VideoHardwareEncoder> {
        struct DummyEncoder;
        impl VideoHardwareEncoder for DummyEncoder {
            fn init(&mut self, _params: CodecParams) -> Result<(), CoreError> { Ok(()) }
            fn reconfigure(&mut self, _bitrate_kbps: u32, _fps: u32, _w: u32, _h: u32) -> Result<(), CoreError> { Ok(()) }
            fn force_intra_frame(&mut self) -> Result<(), CoreError> { Ok(()) }
            fn encode_rgba_frame(&mut self, _f: &[u8], _w: u32, _h: u32) -> Result<Vec<u8>, CoreError> { Ok(vec![]) }
            fn encode_frame_zero_copy(&mut self, _tex: &FrameBuffer) -> Result<Vec<u8>, CoreError> { Ok(vec![]) }
        }
        Box::new(DummyEncoder)
    }
}
