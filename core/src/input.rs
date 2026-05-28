use crate::CoreError;
use std::convert::TryInto;

/// 輸入事件類型
#[derive(Debug, Clone, PartialEq)]
pub enum InputEvent {
    MouseMove { x: f32, y: f32 }, // 支援浮點數比例座標，適應不同解析度
    MouseDown { button: MouseButton },
    MouseUp { button: MouseButton },
    MouseScroll { delta_x: i16, delta_y: i16 },
    KeyDown { keycode: u16, modifiers: u8 },
    KeyUp { keycode: u16, modifiers: u8 },
    MouseRelativeMove { dx: i32, dy: i32 }, // 相對位移，用於 Pointer Lock 支援原生滑鼠加速度
    TextInput { text: String }, // 原生字元注入 (Unicode)
}

/// 滑鼠按鍵類型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left = 1,
    Right = 2,
    Middle = 3,
}

impl InputEvent {
    /// 序列化為緊湊的二進位位元組陣列（用於極低延遲 Data Channel 傳輸）
    pub fn serialize(&self) -> Vec<u8> {
        let mut buffer = Vec::new();
        match self {
            InputEvent::MouseMove { x, y } => {
                buffer.push(0x01); // Event Type ID
                buffer.extend_from_slice(&x.to_be_bytes());
                buffer.extend_from_slice(&y.to_be_bytes());
            }
            InputEvent::MouseDown { button } => {
                buffer.push(0x02);
                buffer.push(*button as u8);
            }
            InputEvent::MouseUp { button } => {
                buffer.push(0x03);
                buffer.push(*button as u8);
            }
            InputEvent::MouseScroll { delta_x, delta_y } => {
                buffer.push(0x04);
                buffer.extend_from_slice(&delta_x.to_be_bytes());
                buffer.extend_from_slice(&delta_y.to_be_bytes());
            }
            InputEvent::KeyDown { keycode, modifiers } => {
                buffer.push(0x05);
                buffer.extend_from_slice(&keycode.to_be_bytes());
                buffer.push(*modifiers);
            }
            InputEvent::KeyUp { keycode, modifiers } => {
                buffer.push(0x06);
                buffer.extend_from_slice(&keycode.to_be_bytes());
                buffer.push(*modifiers);
            }
            InputEvent::MouseRelativeMove { dx, dy } => {
                buffer.push(0x07);
                buffer.extend_from_slice(&dx.to_be_bytes());
                buffer.extend_from_slice(&dy.to_be_bytes());
            }
            InputEvent::TextInput { text } => {
                buffer.push(0x08);
                buffer.extend_from_slice(text.as_bytes());
            }
        }
        buffer
    }

    /// 從二進位位元組陣列還原輸入事件
    pub fn deserialize(data: &[u8]) -> Result<Self, CoreError> {
        if data.is_empty() {
            return Err(CoreError::NetworkError("輸入事件封包長度為零".to_string()));
        }
        
        let event_type = data[0];
        match event_type {
            0x01 => {
                if data.len() < 9 { return Err(CoreError::NetworkError("MouseMove 封包長度不足".to_string())); }
                let x = f32::from_be_bytes(data[1..5].try_into().unwrap());
                let y = f32::from_be_bytes(data[5..9].try_into().unwrap());
                Ok(InputEvent::MouseMove { x, y })
            }
            0x02 => {
                if data.len() < 2 { return Err(CoreError::NetworkError("MouseDown 封包長度不足".to_string())); }
                let button = match data[1] {
                    1 => MouseButton::Left,
                    2 => MouseButton::Right,
                    3 => MouseButton::Middle,
                    _ => return Err(CoreError::NetworkError("無效的滑鼠按鍵值".to_string())),
                };
                Ok(InputEvent::MouseDown { button })
            }
            0x03 => {
                if data.len() < 2 { return Err(CoreError::NetworkError("MouseUp 封包長度不足".to_string())); }
                let button = match data[1] {
                    1 => MouseButton::Left,
                    2 => MouseButton::Right,
                    3 => MouseButton::Middle,
                    _ => return Err(CoreError::NetworkError("無效的滑鼠按鍵值".to_string())),
                };
                Ok(InputEvent::MouseUp { button })
            }
            0x04 => {
                if data.len() < 5 { return Err(CoreError::NetworkError("MouseScroll 封包長度不足".to_string())); }
                let delta_x = i16::from_be_bytes(data[1..3].try_into().unwrap());
                let delta_y = i16::from_be_bytes(data[3..5].try_into().unwrap());
                Ok(InputEvent::MouseScroll { delta_x, delta_y })
            }
            0x05 => {
                if data.len() < 4 { return Err(CoreError::NetworkError("KeyDown 封包長度不足".to_string())); }
                let keycode = u16::from_be_bytes(data[1..3].try_into().unwrap());
                let modifiers = data[3];
                Ok(InputEvent::KeyDown { keycode, modifiers })
            }
            0x06 => {
                if data.len() < 4 { return Err(CoreError::NetworkError("KeyUp 封包長度不足".to_string())); }
                let keycode = u16::from_be_bytes(data[1..3].try_into().unwrap());
                let modifiers = data[3];
                Ok(InputEvent::KeyUp { keycode, modifiers })
            }
            0x07 => {
                if data.len() < 9 { return Err(CoreError::NetworkError("MouseRelativeMove 封包長度不足".to_string())); }
                let dx = i32::from_be_bytes(data[1..5].try_into().unwrap());
                let dy = i32::from_be_bytes(data[5..9].try_into().unwrap());
                Ok(InputEvent::MouseRelativeMove { dx, dy })
            }
            0x08 => {
                let text = String::from_utf8_lossy(&data[1..]).into_owned();
                Ok(InputEvent::TextInput { text })
            }
            _ => Err(CoreError::NetworkError(format!("未知的輸入事件類型: 0x{:02X}", event_type))),
        }
    }

    /// 在被控端作業系統中虛擬模擬此輸入事件，達成實體操作控制
    pub fn simulate(&self) -> Result<(), CoreError> {
        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
            use std::mem::size_of;

            unsafe {
                let mut input = std::mem::zeroed::<INPUT>();
                
                match self {
                    InputEvent::MouseMove { x, y } => {
                        // 設定為絕對座標定位，對應螢幕解析度 (0 ~ 65535)
                        input.r#type = INPUT_MOUSE;
                        input.Anonymous.mi.dx = (*x * 65535.0) as i32;
                        input.Anonymous.mi.dy = (*y * 65535.0) as i32;
                        input.Anonymous.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
                    }
                    InputEvent::MouseDown { button } => {
                        input.r#type = INPUT_MOUSE;
                        input.Anonymous.mi.dwFlags = match button {
                            MouseButton::Left => MOUSEEVENTF_LEFTDOWN,
                            MouseButton::Right => MOUSEEVENTF_RIGHTDOWN,
                            MouseButton::Middle => MOUSEEVENTF_MIDDLEDOWN,
                        };
                    }
                    InputEvent::MouseUp { button } => {
                        input.r#type = INPUT_MOUSE;
                        input.Anonymous.mi.dwFlags = match button {
                            MouseButton::Left => MOUSEEVENTF_LEFTUP,
                            MouseButton::Right => MOUSEEVENTF_RIGHTUP,
                            MouseButton::Middle => MOUSEEVENTF_MIDDLEUP,
                        };
                    }
                    InputEvent::MouseScroll { delta_x: _, delta_y } => {
                        input.r#type = INPUT_MOUSE;
                        input.Anonymous.mi.dwFlags = MOUSEEVENTF_WHEEL;
                        input.Anonymous.mi.mouseData = *delta_y as u32;
                    }
                    InputEvent::KeyDown { keycode, modifiers: _ } => {
                        input.r#type = INPUT_KEYBOARD;
                        input.Anonymous.ki.wVk = *keycode;
                        input.Anonymous.ki.dwFlags = 0; // 0 代表 KeyDown
                    }
                    InputEvent::KeyUp { keycode, modifiers: _ } => {
                        input.r#type = INPUT_KEYBOARD;
                        input.Anonymous.ki.wVk = *keycode;
                        input.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                    }
                    InputEvent::MouseRelativeMove { dx, dy } => {
                        input.r#type = INPUT_MOUSE;
                        input.Anonymous.mi.dx = *dx;
                        input.Anonymous.mi.dy = *dy;
                        input.Anonymous.mi.dwFlags = MOUSEEVENTF_MOVE;
                    }
                    InputEvent::TextInput { text } => {
                        for ch in text.encode_utf16() {
                            let mut txt_input = std::mem::zeroed::<INPUT>();
                            txt_input.r#type = INPUT_KEYBOARD;
                            txt_input.Anonymous.ki.wVk = 0;
                            txt_input.Anonymous.ki.wScan = ch;
                            txt_input.Anonymous.ki.dwFlags = KEYEVENTF_UNICODE;
                            
                            if SendInput(1, &txt_input, size_of::<INPUT>() as i32) == 0 {
                                return Err(CoreError::SystemError("Windows SendInput(Unicode) 呼叫失敗".to_string()));
                            }
                            
                            txt_input.Anonymous.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                            if SendInput(1, &txt_input, size_of::<INPUT>() as i32) == 0 {
                                return Err(CoreError::SystemError("Windows SendInput(Unicode KeyUp) 呼叫失敗".to_string()));
                            }
                        }
                        return Ok(());
                    }
                }
                
                let sent = SendInput(1, &input, size_of::<INPUT>() as i32);
                if sent == 0 {
                    return Err(CoreError::SystemError("Windows SendInput 呼叫失敗".to_string()));
                }
            }
            Ok(())
        }

        #[cfg(target_os = "macos")]
        {
            use core_graphics::event::{CGEvent, CGEventTapLocation, CGMouseButton, CGEventType};
            use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

            let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
                .map_err(|_| CoreError::SystemError("無法建立 CGEventSource".to_string()))?;

            // 動態獲取 Mac 主螢幕解析度物理邊界，避免 Retina 螢幕或不同螢幕比例下的座標漂移失真
            let bounds = core_graphics::display::CGDisplay::main().bounds();
            let screen_w = bounds.size.width;
            let screen_h = bounds.size.height;

            match self {
                InputEvent::MouseMove { x, y } => {
                    let point = core_graphics::geometry::CGPoint::new((*x as f64 * screen_w), (*y as f64 * screen_h));
                    let event = CGEvent::new_mouse_event(
                        source,
                        CGEventType::MouseMoved,
                        point,
                        CGMouseButton::Left
                    ).map_err(|_| CoreError::SystemError("建立 macOS 滑鼠移動事件失敗".to_string()))?;
                    
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::MouseDown { button } => {
                    let (evt_type, cg_button) = match button {
                        MouseButton::Left => (CGEventType::LeftMouseDown, CGMouseButton::Left),
                        MouseButton::Right => (CGEventType::RightMouseDown, CGMouseButton::Right),
                        MouseButton::Middle => (CGEventType::OtherMouseDown, CGMouseButton::Center),
                    };
                    // 獲取當前滑鼠位置
                    let current_point = CGEvent::new(source.clone()).unwrap().location();
                    let event = CGEvent::new_mouse_event(source, evt_type, current_point, cg_button)
                        .map_err(|_| CoreError::SystemError("建立 macOS 按鍵壓下事件失敗".to_string()))?;
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::MouseUp { button } => {
                    let (evt_type, cg_button) = match button {
                        MouseButton::Left => (CGEventType::LeftMouseUp, CGMouseButton::Left),
                        MouseButton::Right => (CGEventType::RightMouseUp, CGMouseButton::Right),
                        MouseButton::Middle => (CGEventType::OtherMouseUp, CGMouseButton::Center),
                    };
                    let current_point = CGEvent::new(source.clone()).unwrap().location();
                    let event = CGEvent::new_mouse_event(source, evt_type, current_point, cg_button)
                        .map_err(|_| CoreError::SystemError("建立 macOS 按鍵放開事件失敗".to_string()))?;
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::MouseScroll { delta_x: _, delta_y } => {
                    // macOS 滾輪事件需使用核心 CoreGraphics C API 進行 FFI 呼叫
                    // 此處做虛擬的輸出，實際整合可透過 CoreGraphics CGEventCreateScrollWheelEvent
                    println!("macOS 滾輪模擬: {}", delta_y);
                }
                InputEvent::KeyDown { keycode, modifiers: _ } => {
                    let event = CGEvent::new_keyboard_event(source, *keycode, true)
                        .map_err(|_| CoreError::SystemError("建立 macOS 鍵盤按下事件失敗".to_string()))?;
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::KeyUp { keycode, modifiers: _ } => {
                    let event = CGEvent::new_keyboard_event(source, *keycode, false)
                        .map_err(|_| CoreError::SystemError("建立 macOS 鍵盤放開事件失敗".to_string()))?;
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::MouseRelativeMove { dx, dy } => {
                    // 為了保留 macOS 的滑鼠加速度，我們取當前座標疊加 dx/dy 後注入，同時設定 DeltaX/Y
                    let current_point = CGEvent::new(source.clone()).unwrap().location();
                    let point = core_graphics::geometry::CGPoint::new(current_point.x + *dx as f64, current_point.y + *dy as f64);
                    let event = CGEvent::new_mouse_event(source, CGEventType::MouseMoved, point, CGMouseButton::Left)
                        .map_err(|_| CoreError::SystemError("建立 macOS 滑鼠相對移動事件失敗".to_string()))?;
                    
                    // 寫入底層的 Event Delta，讓 macOS 得以計算並應用滑鼠加速度曲線
                    event.set_integer_value_field(core_graphics::event::EventField::MOUSE_EVENT_DELTA_X, *dx as i64);
                    event.set_integer_value_field(core_graphics::event::EventField::MOUSE_EVENT_DELTA_Y, *dy as i64);
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::TextInput { text } => {
                    let event = CGEvent::new_keyboard_event(source.clone(), 0, true)
                        .map_err(|_| CoreError::SystemError("建立 macOS 鍵盤注入事件失敗".to_string()))?;
                    let utf16: Vec<u16> = text.encode_utf16().collect();
                    unsafe {
                        extern "C" {
                            pub fn CGEventKeyboardSetUnicodeString(
                                event: core_graphics::sys::CGEventRef,
                                stringLength: libc::size_t,
                                unicodeString: *const u16,
                            );
                        }
                        use foreign_types_shared::ForeignType;
                        CGEventKeyboardSetUnicodeString(
                            event.as_ptr() as *mut _,
                            utf16.len() as libc::size_t,
                            utf16.as_ptr(),
                        );
                    }
                    event.post(CGEventTapLocation::HID);
                }
            }
            Ok(())
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            // Linux / Android 平台模擬輸入骨架
            println!("非 Windows / macOS 平台模擬輸入: {:?}", self);
            Ok(())
        }
    }
}

/// 封裝輸入事件的安全傳輸封包，具備序號與時間戳記以抵禦重放攻擊
#[derive(Debug, Clone)]
pub struct SecureInputPacket {
    pub sequence_number: u32,
    pub timestamp_ms: u64,
    pub event: InputEvent,
}

impl SecureInputPacket {
    /// 建立具備當前系統時間戳記的安全輸入封包
    pub fn new(sequence_number: u32, event: InputEvent) -> Self {
        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Self {
            sequence_number,
            timestamp_ms,
            event,
        }
    }

    /// 序列化為安全位元組流 [Seq: 4B] + [Timestamp: 8B] + [EventData]
    pub fn serialize(&self) -> Vec<u8> {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(&self.sequence_number.to_be_bytes());
        buffer.extend_from_slice(&self.timestamp_ms.to_be_bytes());
        buffer.extend_from_slice(&self.event.serialize());
        buffer
    }

    /// 從安全位元組流還原 SecureInputPacket
    pub fn deserialize(data: &[u8]) -> Result<Self, CoreError> {
        if data.len() < 12 {
            return Err(CoreError::NetworkError("安全輸入封包長度不足".to_string()));
        }
        let sequence_number = u32::from_be_bytes(data[0..4].try_into().unwrap());
        let timestamp_ms = u64::from_be_bytes(data[4..12].try_into().unwrap());
        let event = InputEvent::deserialize(&data[12..])?;
        Ok(SecureInputPacket {
            sequence_number,
            timestamp_ms,
            event,
        })
    }

    /// 驗證封包安全性，防禦重放與過期封包
    pub fn verify(&self, last_seq: u32) -> Result<(), CoreError> {
        // 1. 驗證序號是否嚴格遞增
        if self.sequence_number <= last_seq {
            return Err(CoreError::NetworkError(format!(
                "重放攻擊防禦：序號未遞增或過期 (收到: {}, 當前最新: {})",
                self.sequence_number, last_seq
            )));
        }
        
        // 2. 驗證時間戳記誤差是否在合理範圍內 (500 ms)
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
            
        let diff = now_ms.abs_diff(self.timestamp_ms);
        
        if diff > 500 {
            return Err(CoreError::NetworkError(format!(
                "重放攻擊防禦：封包時間戳記過期，誤差達 {} ms",
                diff
            )));
        }
        
        Ok(())
    }
}
