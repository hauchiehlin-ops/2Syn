use crate::CoreError;

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
    
    /// macOS CoreVideo 紋理指標 (零拷貝專用)
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    CVPixelBuffer(*mut std::ffi::c_void),
}

/// 跨平台硬體畫面擷取 (Screen Capture) 介面
pub trait ScreenCapturer {
    /// 初始化擷取管線
    fn init(&mut self) -> Result<(), CoreError>;

    /// 獲取下一幀畫面
    fn acquire_next_frame(&mut self) -> Result<FrameBuffer, CoreError>;
}

/// 跨平台硬體視訊編碼器介面
pub trait VideoHardwareEncoder {
    /// 初始化編碼器
    fn init(&mut self, params: CodecParams) -> Result<(), CoreError>;

    /// 動態調整編碼位元率與畫面更新率
    fn reconfigure(&mut self, bitrate_kbps: u32, fps: u32) -> Result<(), CoreError>;

    /// 常規編碼：將系統 CPU 記憶體影像進行編碼
    fn encode_frame(&mut self, frame: &[u8]) -> Result<Vec<u8>, CoreError>;

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

#[cfg(target_os = "windows")]
pub struct WindowsHardwareEncoder {
    params: Option<CodecParams>,
}

#[cfg(target_os = "windows")]
impl WindowsHardwareEncoder {
    pub fn new() -> Self { Self { params: None } }
}

#[cfg(target_os = "windows")]
impl VideoHardwareEncoder for WindowsHardwareEncoder {
    fn init(&mut self, params: CodecParams) -> Result<(), CoreError> {
        self.params = Some(params);
        Ok(())
    }

    fn reconfigure(&mut self, bitrate_kbps: u32, fps: u32) -> Result<(), CoreError> {
        if let Some(ref mut p) = self.params {
            p.bitrate_kbps = bitrate_kbps;
            p.fps = fps;
            Ok(())
        } else {
            Err(CoreError::HardwareCodecError("編碼器未初始化".to_string()))
        }
    }

    fn encode_frame(&mut self, _frame: &[u8]) -> Result<Vec<u8>, CoreError> {
        Ok(vec![0x00, 0x00, 0x00, 0x01, 0x67])
    }

    fn encode_frame_zero_copy(&mut self, gpu_texture: &FrameBuffer) -> Result<Vec<u8>, CoreError> {
        if let FrameBuffer::D3D11Texture(texture_ptr) = gpu_texture {
            // NVENC / AMF 零拷貝編碼核心邏輯：
            // 1. 使用 ID3D11Texture2D 介面指標 (texture_ptr)
            // 2. 呼叫 nvEncRegisterResource 將 D3D11 Texture 註冊給 NVENC 引擎
            // 3. 呼叫 nvEncMapInputResource 取得 NVENC 可寫入之 GPU 緩衝區
            // 4. 呼叫 nvEncEncodePicture 執行 GPU 顯存內直接壓縮
            // 5. 呼叫 nvEncUnmapInputResource 釋放資源
            if texture_ptr.is_null() {
                return Err(CoreError::HardwareCodecError("無效的 GPU 紋理指標".to_string()));
            }
            Ok(vec![0x00, 0x00, 0x00, 0x01, 0x65]) // 模擬編碼輸出 NALU
        } else {
            Err(CoreError::HardwareCodecError("不支援的編碼紋理類型".to_string()))
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub struct AppleHardwareEncoder {
    params: Option<CodecParams>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl Default for AppleHardwareEncoder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl AppleHardwareEncoder {
    pub fn new() -> Self { Self { params: None } }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl VideoHardwareEncoder for AppleHardwareEncoder {
    fn init(&mut self, params: CodecParams) -> Result<(), CoreError> {
        self.params = Some(params);
        Ok(())
    }

    fn reconfigure(&mut self, bitrate_kbps: u32, fps: u32) -> Result<(), CoreError> {
        if let Some(ref mut p) = self.params {
            p.bitrate_kbps = bitrate_kbps;
            p.fps = fps;
            Ok(())
        } else {
            Err(CoreError::HardwareCodecError("編碼器未初始化".to_string()))
        }
    }

    fn encode_frame(&mut self, _frame: &[u8]) -> Result<Vec<u8>, CoreError> {
        Ok(vec![0x00, 0x00, 0x00, 0x01, 0x27])
    }

    fn encode_frame_zero_copy(&mut self, gpu_texture: &FrameBuffer) -> Result<Vec<u8>, CoreError> {
        if let FrameBuffer::CVPixelBuffer(_pixel_buffer_ptr) = gpu_texture {
            // VideoToolbox 零拷貝編碼核心邏輯：
            // 1. 將 CVPixelBufferRef 直接傳遞給 VTCompressionSessionEncodeFrame
            // 2. 這使 OS 能夠直接從 GPU FrameBuffer 記憶體壓縮，避開記憶體拷貝
            Ok(vec![0x00, 0x00, 0x00, 0x01, 0x25])
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
    pub fn create_encoder() -> Box<dyn VideoHardwareEncoder> {
        Box::new(WindowsHardwareEncoder::new())
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
            fn reconfigure(&mut self, _bitrate_kbps: u32, _fps: u32) -> Result<(), CoreError> { Ok(()) }
            fn encode_frame(&mut self, _f: &[u8]) -> Result<Vec<u8>, CoreError> { Ok(vec![]) }
            fn encode_frame_zero_copy(&mut self, _tex: &FrameBuffer) -> Result<Vec<u8>, CoreError> { Ok(vec![]) }
        }
        Box::new(DummyEncoder)
    }
}
