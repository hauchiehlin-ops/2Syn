use crate::CoreError;
use std::convert::TryInto;
use std::sync::atomic::{AtomicI32, AtomicU32, Ordering};

pub static TARGET_MONITOR_X: AtomicI32 = AtomicI32::new(0);
pub static TARGET_MONITOR_Y: AtomicI32 = AtomicI32::new(0);
pub static TARGET_MONITOR_W: AtomicU32 = AtomicU32::new(0);
pub static TARGET_MONITOR_H: AtomicU32 = AtomicU32::new(0);

/// 全域滑鼠游標追蹤，供後端雙軌擷取引擎（Foveated Streaming）定位 ROI 中心點
/// 儲存 f32 位元結構的 Atomic 變數
pub static CURSOR_X: AtomicU32 = AtomicU32::new(0);
pub static CURSOR_Y: AtomicU32 = AtomicU32::new(0);

pub fn set_global_cursor(x: f32, y: f32) {
    CURSOR_X.store(x.to_bits(), Ordering::Relaxed);
    CURSOR_Y.store(y.to_bits(), Ordering::Relaxed);
}

pub fn get_global_cursor() -> (f32, f32) {
    let x = f32::from_bits(CURSOR_X.load(Ordering::Relaxed));
    let y = f32::from_bits(CURSOR_Y.load(Ordering::Relaxed));
    (x, y)
}

/// 輸入事件類型
#[derive(Debug, Clone, PartialEq)]
pub enum InputEvent {
    MouseMove { x: f32, y: f32 }, // 支援浮點數比例座標，適應不同解析度
    // 按下/放開自帶座標，避免與 MouseMove（走獨立的 unreliable channel）之間
    // 因跨 channel 到達順序不保證而產生的點擊位置競態（見 DEVLOG）
    MouseDown { button: MouseButton, x: f32, y: f32 },
    MouseUp { button: MouseButton, x: f32, y: f32 },
    MouseScroll { delta_x: i16, delta_y: i16 },
    KeyDown { keycode: u16, modifiers: u8 },
    KeyUp { keycode: u16, modifiers: u8 },
    MouseRelativeMove { dx: i32, dy: i32 }, // 相對位移，用於 Pointer Lock 支援原生滑鼠加速度
    TextInput { text: String }, // 原生字元注入 (Unicode)
    PenMove { x: f32, y: f32, pressure: u16, tilt_x: i8, tilt_y: i8 }, // Apple Pencil / 觸控筆壓力感應
    ResetState,
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
            InputEvent::MouseDown { button, x, y } => {
                buffer.push(0x02);
                buffer.push(*button as u8);
                buffer.extend_from_slice(&x.to_be_bytes());
                buffer.extend_from_slice(&y.to_be_bytes());
            }
            InputEvent::MouseUp { button, x, y } => {
                buffer.push(0x03);
                buffer.push(*button as u8);
                buffer.extend_from_slice(&x.to_be_bytes());
                buffer.extend_from_slice(&y.to_be_bytes());
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
            InputEvent::PenMove { x, y, pressure, tilt_x, tilt_y } => {
                buffer.push(0x09);
                buffer.extend_from_slice(&x.to_be_bytes());
                buffer.extend_from_slice(&y.to_be_bytes());
                buffer.extend_from_slice(&pressure.to_be_bytes());
                buffer.push(*tilt_x as u8);
                buffer.push(*tilt_y as u8);
            }
            InputEvent::ResetState => {
                buffer.push(0xFF);
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
                if data.len() < 10 { return Err(CoreError::NetworkError("MouseDown 封包長度不足".to_string())); }
                let button = match data[1] {
                    1 => MouseButton::Left,
                    2 => MouseButton::Right,
                    3 => MouseButton::Middle,
                    _ => return Err(CoreError::NetworkError("無效的滑鼠按鍵值".to_string())),
                };
                let x = f32::from_be_bytes(data[2..6].try_into().unwrap());
                let y = f32::from_be_bytes(data[6..10].try_into().unwrap());
                Ok(InputEvent::MouseDown { button, x, y })
            }
            0x03 => {
                if data.len() < 10 { return Err(CoreError::NetworkError("MouseUp 封包長度不足".to_string())); }
                let button = match data[1] {
                    1 => MouseButton::Left,
                    2 => MouseButton::Right,
                    3 => MouseButton::Middle,
                    _ => return Err(CoreError::NetworkError("無效的滑鼠按鍵值".to_string())),
                };
                let x = f32::from_be_bytes(data[2..6].try_into().unwrap());
                let y = f32::from_be_bytes(data[6..10].try_into().unwrap());
                Ok(InputEvent::MouseUp { button, x, y })
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
                if data.len() < 2 { return Err(CoreError::NetworkError("TextInput 封包長度不足".to_string())); }
                let text = String::from_utf8(data[1..].to_vec())
                    .map_err(|_| CoreError::NetworkError("TextInput 封包非有效 UTF-8".to_string()))?;
                Ok(InputEvent::TextInput { text })
            }
            0x09 => {
                if data.len() < 13 { return Err(CoreError::NetworkError("PenMove 封包長度不足".to_string())); }
                let x = f32::from_be_bytes(data[1..5].try_into().unwrap());
                let y = f32::from_be_bytes(data[5..9].try_into().unwrap());
                let pressure = u16::from_be_bytes(data[9..11].try_into().unwrap());
                let tilt_x = data[11] as i8;
                let tilt_y = data[12] as i8;
                Ok(InputEvent::PenMove { x, y, pressure, tilt_x, tilt_y })
            }
            0xFF => {
                Ok(InputEvent::ResetState)
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

            // 將正規化座標 (0..1) 轉為 SendInput 的絕對座標 dx/dy（與 MouseMove 相同換算邏輯），
            // 讓 MouseDown/MouseUp 不必依賴另一個 channel 送來的 MouseMove 副作用去定位游標。
            fn absolute_mouse_dxdy(x: f32, y: f32) -> (i32, i32, u32) {
                use windows_sys::Win32::UI::WindowsAndMessaging::{
                    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN
                };
                let clamped_x = x.clamp(0.0, 1.0);
                let clamped_y = y.clamp(0.0, 1.0);
                let tx = TARGET_MONITOR_X.load(Ordering::Relaxed);
                let ty = TARGET_MONITOR_Y.load(Ordering::Relaxed);
                let tw = TARGET_MONITOR_W.load(Ordering::Relaxed);
                let th = TARGET_MONITOR_H.load(Ordering::Relaxed);
                let mut flags = MOUSEEVENTF_ABSOLUTE;
                if tw > 0 && th > 0 {
                    flags |= MOUSEEVENTF_VIRTUALDESKTOP;
                    let abs_x = tx + (clamped_x as f64 * tw as f64) as i32;
                    let abs_y = ty + (clamped_y as f64 * th as f64) as i32;
                    unsafe {
                        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
                        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
                        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
                        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
                        let dx = if vw > 1 { ((abs_x - vx) * 65535) / (vw - 1) } else { 0 };
                        let dy = if vh > 1 { ((abs_y - vy) * 65535) / (vh - 1) } else { 0 };
                        (dx, dy, flags)
                    }
                } else {
                    let dx = (clamped_x * 65535.0) as i32;
                    let dy = (clamped_y * 65535.0) as i32;
                    (dx, dy, flags)
                }
            }

            unsafe {
                let mut input = std::mem::zeroed::<INPUT>();
                
                match self {
                    InputEvent::MouseMove { x, y } => {
                        let clamped_x = x.clamp(0.0, 1.0);
                        let clamped_y = y.clamp(0.0, 1.0);
                        // 更新全域游標位置
                        set_global_cursor(clamped_x, clamped_y);
                        
                        input.r#type = INPUT_MOUSE;
                        
                        let tx = TARGET_MONITOR_X.load(Ordering::Relaxed);
                        let ty = TARGET_MONITOR_Y.load(Ordering::Relaxed);
                        let tw = TARGET_MONITOR_W.load(Ordering::Relaxed);
                        let th = TARGET_MONITOR_H.load(Ordering::Relaxed);
                        
                        let mut flags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
                        let (dx, dy) = if tw > 0 && th > 0 {
                            flags |= MOUSEEVENTF_VIRTUALDESKTOP;
                            let abs_x = tx + (clamped_x as f64 * tw as f64) as i32;
                            let abs_y = ty + (clamped_y as f64 * th as f64) as i32;
                            
                            use windows_sys::Win32::UI::WindowsAndMessaging::{
                                GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN
                            };
                            let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
                            let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
                            let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
                            let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
                            
                            let dx = if vw > 1 { ((abs_x - vx) * 65535) / (vw - 1) } else { 0 };
                            let dy = if vh > 1 { ((abs_y - vy) * 65535) / (vh - 1) } else { 0 };
                            (dx, dy)
                        } else {
                            let dx = (clamped_x * 65535.0) as i32;
                            let dy = (clamped_y * 65535.0) as i32;
                            (dx, dy)
                        };
                        
                        input.Anonymous.mi.dx = dx;
                        input.Anonymous.mi.dy = dy;
                        input.Anonymous.mi.dwFlags = flags;
                    }
                    InputEvent::MouseDown { button, x, y } => {
                        input.r#type = INPUT_MOUSE;
                        let (dx, dy, mut flags) = absolute_mouse_dxdy(*x, *y);
                        flags |= match button {
                            MouseButton::Left => MOUSEEVENTF_LEFTDOWN,
                            MouseButton::Right => MOUSEEVENTF_RIGHTDOWN,
                            MouseButton::Middle => MOUSEEVENTF_MIDDLEDOWN,
                        };
                        input.Anonymous.mi.dx = dx;
                        input.Anonymous.mi.dy = dy;
                        input.Anonymous.mi.dwFlags = flags;
                    }
                    InputEvent::MouseUp { button, x, y } => {
                        input.r#type = INPUT_MOUSE;
                        let (dx, dy, mut flags) = absolute_mouse_dxdy(*x, *y);
                        flags |= match button {
                            MouseButton::Left => MOUSEEVENTF_LEFTUP,
                            MouseButton::Right => MOUSEEVENTF_RIGHTUP,
                            MouseButton::Middle => MOUSEEVENTF_MIDDLEUP,
                        };
                        input.Anonymous.mi.dx = dx;
                        input.Anonymous.mi.dy = dy;
                        input.Anonymous.mi.dwFlags = flags;
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
                    InputEvent::PenMove { x, y, pressure: _, tilt_x: _, tilt_y: _ } => {
                        // Windows 上暫時以普通 MouseMove 處理（不模擬 WinTab 壓力）
                        input.r#type = INPUT_MOUSE;
                        let flags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
                        let abs_x = (*x * 65535.0) as i32;
                        let abs_y = (*y * 65535.0) as i32;
                        input.Anonymous.mi.dx = abs_x;
                        input.Anonymous.mi.dy = abs_y;
                        input.Anonymous.mi.dwFlags = flags;
                    }
                    InputEvent::ResetState => {
                        input.r#type = INPUT_KEYBOARD;
                        input.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
                        // 釋放 Shift, Ctrl, Alt, Win 鍵
                        let keys_to_release = [
                            VK_LSHIFT, VK_RSHIFT,
                            VK_LCONTROL, VK_RCONTROL,
                            VK_LMENU, VK_RMENU,
                            VK_LWIN, VK_RWIN
                        ];
                        for &vk in &keys_to_release {
                            input.Anonymous.ki.wVk = vk;
                            SendInput(1, &input, size_of::<INPUT>() as i32);
                        }
                        
                        // 釋放滑鼠按鍵
                        input.r#type = INPUT_MOUSE;
                        input.Anonymous.mi.dx = 0;
                        input.Anonymous.mi.dy = 0;
                        input.Anonymous.mi.dwFlags = MOUSEEVENTF_LEFTUP | MOUSEEVENTF_RIGHTUP | MOUSEEVENTF_MIDDLEUP;
                        SendInput(1, &input, size_of::<INPUT>() as i32);
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
            use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};

            static LEFT_BTN_DOWN: AtomicBool = AtomicBool::new(false);
            static RIGHT_BTN_DOWN: AtomicBool = AtomicBool::new(false);

            // 連擊偵測：macOS 的雙擊不是由 WindowServer 自動判定，而是要求事件本身
            // 帶有 clickState=2（三擊=3）。若恆為 1，Finder 雙擊開啟資料夾等操作永遠無效。
            static LAST_LEFT_DOWN_MS: AtomicU64 = AtomicU64::new(0);
            static LAST_CLICK_X: AtomicI64 = AtomicI64::new(0);
            static LAST_CLICK_Y: AtomicI64 = AtomicI64::new(0);
            static CLICK_STATE: AtomicI64 = AtomicI64::new(1);

            // 修飾鍵按住狀態：macOS 合成事件的修飾鍵「按下鍵碼」不會自動讓後續按鍵
            // 帶上 flag（與實體鍵盤不同），因此必須自行追蹤按住的修飾鍵，
            // 並在每個一般按鍵事件上明確 set_flags，否則 ⌘C 只會輸入字元 "c"。
            static MOD_CMD_DOWN: AtomicBool = AtomicBool::new(false);
            static MOD_SHIFT_DOWN: AtomicBool = AtomicBool::new(false);
            static MOD_ALT_DOWN: AtomicBool = AtomicBool::new(false);
            static MOD_CTRL_DOWN: AtomicBool = AtomicBool::new(false);

            // 依目前按住的修飾鍵組出 CGEventFlags
            fn current_mod_flags() -> core_graphics::event::CGEventFlags {
                use core_graphics::event::CGEventFlags;
                let mut flags = CGEventFlags::CGEventFlagNull;
                if MOD_CMD_DOWN.load(Ordering::Relaxed) { flags |= CGEventFlags::CGEventFlagCommand; }
                if MOD_SHIFT_DOWN.load(Ordering::Relaxed) { flags |= CGEventFlags::CGEventFlagShift; }
                if MOD_ALT_DOWN.load(Ordering::Relaxed) { flags |= CGEventFlags::CGEventFlagAlternate; }
                if MOD_CTRL_DOWN.load(Ordering::Relaxed) { flags |= CGEventFlags::CGEventFlagControl; }
                flags
            }

            let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
                .map_err(|_| CoreError::SystemError("無法建立 CGEventSource".to_string()))?;

            // Windows VK to Mac CGKeyCode 對照表
            fn vk_to_mac_keycode(vk: u16) -> u16 {
                match vk {
                    65 => 0,   // A
                    83 => 1,   // S
                    68 => 2,   // D
                    70 => 3,   // F
                    72 => 4,   // H
                    71 => 5,   // G
                    90 => 6,   // Z
                    88 => 7,   // X
                    67 => 8,   // C
                    86 => 9,   // V
                    66 => 11,  // B
                    81 => 12,  // Q
                    87 => 13,  // W
                    69 => 14,  // E
                    82 => 15,  // R
                    89 => 16,  // Y
                    84 => 17,  // T
                    49 => 18,  // 1
                    50 => 19,  // 2
                    51 => 20,  // 3
                    52 => 21,  // 4
                    54 => 22,  // 6
                    53 => 23,  // 5
                    187 => 24, // =
                    57 => 25,  // 9
                    55 => 26,  // 7
                    189 => 27, // -
                    56 => 28,  // 8
                    48 => 29,  // 0
                    221 => 30, // ]
                    79 => 31,  // O
                    85 => 32,  // U
                    219 => 33, // [
                    73 => 34,  // I
                    80 => 35,  // P
                    13 => 36,  // Return
                    76 => 37,  // L
                    74 => 38,  // J
                    222 => 39, // '
                    75 => 40,  // K
                    186 => 41, // ;
                    220 => 42, // \
                    188 => 43, // ,
                    191 => 44, // /
                    78 => 45,  // N
                    77 => 46,  // M
                    190 => 47, // .
                    9 => 48,   // Tab
                    32 => 49,  // Space
                    192 => 50, // `
                    8 => 51,   // Backspace
                    27 => 53,  // Esc
                    91 => 55,  // Command/Windows
                    93 => 55,  // Right Command
                    16 => 56,  // Shift
                    20 => 57,  // CapsLock
                    18 => 58,  // Alt/Option
                    17 => 59,  // Ctrl
                    38 => 126, // Up
                    40 => 125, // Down
                    37 => 123, // Left
                    39 => 124, // Right
                    _ => vk,   // Fallback
                }
            }

            // 動態獲取 Mac 主螢幕解析度物理邊界，避免 Retina 螢幕或不同螢幕比例下的座標漂移失真
            let bounds = core_graphics::display::CGDisplay::main().bounds();
            let screen_w = bounds.size.width;
            let screen_h = bounds.size.height;

            match self {
                InputEvent::MouseMove { x, y } => {
                    let clamped_x = x.clamp(0.0, 1.0);
                    let clamped_y = y.clamp(0.0, 1.0);
                    // 更新全域游標位置
                    set_global_cursor(clamped_x, clamped_y);
                    
                    let tx = TARGET_MONITOR_X.load(Ordering::Relaxed);
                    let ty = TARGET_MONITOR_Y.load(Ordering::Relaxed);
                    let tw = TARGET_MONITOR_W.load(Ordering::Relaxed);
                    let th = TARGET_MONITOR_H.load(Ordering::Relaxed);
                    
                    let point = if tw > 0 && th > 0 {
                        core_graphics::geometry::CGPoint::new(
                            tx as f64 + clamped_x as f64 * tw as f64,
                            ty as f64 + clamped_y as f64 * th as f64,
                        )
                    } else {
                        core_graphics::geometry::CGPoint::new(
                            clamped_x as f64 * screen_w,
                            clamped_y as f64 * screen_h,
                        )
                    };
                    
                    let mut event_type = CGEventType::MouseMoved;
                    let mut mouse_btn = CGMouseButton::Left;
                    
                    if LEFT_BTN_DOWN.load(Ordering::Relaxed) {
                        event_type = CGEventType::LeftMouseDragged;
                    } else if RIGHT_BTN_DOWN.load(Ordering::Relaxed) {
                        event_type = CGEventType::RightMouseDragged;
                        mouse_btn = CGMouseButton::Right;
                    }
                    
                    let event = CGEvent::new_mouse_event(source, event_type, point, mouse_btn)
                        .map_err(|_| CoreError::SystemError("建立 macOS 滑鼠移動事件失敗".to_string()))?;
                    
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::MouseDown { button, x, y } => {
                    // 使用封包自帶座標計算點擊位置，而非另外追蹤的全域游標狀態：
                    // MouseMove 走 unreliable channel、MouseDown 走 reliable channel，
                    // 兩者到達順序沒有保證，依賴共享的全域游標會有競爭導致點擊位置偏移。
                    let (gx, gy) = (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0));
                    let tx = TARGET_MONITOR_X.load(Ordering::Relaxed);
                    let ty = TARGET_MONITOR_Y.load(Ordering::Relaxed);
                    let tw = TARGET_MONITOR_W.load(Ordering::Relaxed);
                    let th = TARGET_MONITOR_H.load(Ordering::Relaxed);
                    let current_point = if tw > 0 && th > 0 {
                        core_graphics::geometry::CGPoint::new(
                            tx as f64 + gx as f64 * tw as f64,
                            ty as f64 + gy as f64 * th as f64,
                        )
                    } else {
                        core_graphics::geometry::CGPoint::new(
                            gx as f64 * screen_w,
                            gy as f64 * screen_h,
                        )
                    };
                    let (evt_type, cg_button) = match button {
                        MouseButton::Left => {
                            LEFT_BTN_DOWN.store(true, Ordering::Relaxed);
                            (CGEventType::LeftMouseDown, CGMouseButton::Left)
                        },
                        MouseButton::Right => {
                            RIGHT_BTN_DOWN.store(true, Ordering::Relaxed);
                            (CGEventType::RightMouseDown, CGMouseButton::Right)
                        },
                        MouseButton::Middle => (CGEventType::OtherMouseDown, CGMouseButton::Center),
                    };
                    // 連擊判定：左鍵在 500ms 內、游標位移 <= 8px 視為連擊，clickState 遞增
                    // （單擊=1、雙擊=2、三擊=3），否則重設為 1。MouseUp 沿用同一狀態。
                    let click_state = if matches!(button, MouseButton::Left) {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        let px = current_point.x as i64;
                        let py = current_point.y as i64;
                        let last_ms = LAST_LEFT_DOWN_MS.swap(now_ms, Ordering::Relaxed);
                        let lx = LAST_CLICK_X.swap(px, Ordering::Relaxed);
                        let ly = LAST_CLICK_Y.swap(py, Ordering::Relaxed);
                        let dx = (px as i128 - lx as i128).unsigned_abs();
                        let dy = (py as i128 - ly as i128).unsigned_abs();
                        let is_multi = last_ms > 0
                            && now_ms.saturating_sub(last_ms) <= 500
                            && dx <= 8
                            && dy <= 8;
                        let state = if is_multi {
                            (CLICK_STATE.load(Ordering::Relaxed) % 3) + 1
                        } else {
                            1
                        };
                        CLICK_STATE.store(state, Ordering::Relaxed);
                        state
                    } else {
                        1
                    };
                    let event = CGEvent::new_mouse_event(source, evt_type, current_point, cg_button)
                        .map_err(|_| CoreError::SystemError("建立 macOS 按鍵壓下事件失敗".to_string()))?;
                    // clickState >= 1：讓合成事件被視為「真實點擊」，確保點擊背景視窗時
                    // WindowServer 正確觸發 click-to-front，且連擊時 app 能判定雙擊/三擊。
                    event.set_integer_value_field(
                        core_graphics::event::EventField::MOUSE_EVENT_CLICK_STATE, click_state);
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::MouseUp { button, x, y } => {
                    let (gx, gy) = (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0));
                    let tx = TARGET_MONITOR_X.load(Ordering::Relaxed);
                    let ty = TARGET_MONITOR_Y.load(Ordering::Relaxed);
                    let tw = TARGET_MONITOR_W.load(Ordering::Relaxed);
                    let th = TARGET_MONITOR_H.load(Ordering::Relaxed);
                    let current_point = if tw > 0 && th > 0 {
                        core_graphics::geometry::CGPoint::new(
                            tx as f64 + gx as f64 * tw as f64,
                            ty as f64 + gy as f64 * th as f64,
                        )
                    } else {
                        core_graphics::geometry::CGPoint::new(
                            gx as f64 * screen_w,
                            gy as f64 * screen_h,
                        )
                    };
                    let (evt_type, cg_button) = match button {
                        MouseButton::Left => {
                            LEFT_BTN_DOWN.store(false, Ordering::Relaxed);
                            (CGEventType::LeftMouseUp, CGMouseButton::Left)
                        },
                        MouseButton::Right => {
                            RIGHT_BTN_DOWN.store(false, Ordering::Relaxed);
                            (CGEventType::RightMouseUp, CGMouseButton::Right)
                        },
                        MouseButton::Middle => (CGEventType::OtherMouseUp, CGMouseButton::Center),
                    };
                    let event = CGEvent::new_mouse_event(source, evt_type, current_point, cg_button)
                        .map_err(|_| CoreError::SystemError("建立 macOS 按鍵放開事件失敗".to_string()))?;
                    // MouseUp 必須帶與對應 MouseDown 相同的 clickState，否則雙擊判定失效
                    let up_state = if matches!(button, MouseButton::Left) {
                        CLICK_STATE.load(Ordering::Relaxed)
                    } else {
                        1
                    };
                    event.set_integer_value_field(
                        core_graphics::event::EventField::MOUSE_EVENT_CLICK_STATE, up_state);
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::MouseScroll { delta_x, delta_y } => {
                    // 使用 CGEventCreateScrollWheelEvent2 FFI 實作真實 macOS 捲動事件
                    extern "C" {
                        fn CGEventCreateScrollWheelEvent2(
                            source: *mut std::ffi::c_void,
                            units: i32,
                            wheel_count: u32,
                            wheel1: i32,
                            wheel2: i32,
                            wheel3: i32,
                        ) -> *mut std::ffi::c_void;
                        fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
                        fn CFRelease(cf: *mut std::ffi::c_void);
                    }
                    use foreign_types_shared::ForeignType;
                    unsafe {
                        // kCGScrollEventUnitLine = 0（自然行捲動）
                        // kCGHIDEventTap = 0
                        // 垂直方向取反以符合 macOS 自然捲動方向
                        let raw_event = CGEventCreateScrollWheelEvent2(
                            source.as_ptr() as *mut std::ffi::c_void,
                            0i32,               // units (kCGScrollEventUnitLine = 0)
                            2u32,               // wheel_count (2 axes: vertical + horizontal)
                            (-*delta_y) as i32, // wheel1: 垂直（取反以符合 macOS 自然方向）
                            (*delta_x) as i32,  // wheel2: 水平
                            0i32,               // wheel3: not used
                        );
                        if !raw_event.is_null() {
                            CGEventPost(0u32, raw_event); // kCGHIDEventTap = 0
                            CFRelease(raw_event);
                        }
                    }
                }
                InputEvent::KeyDown { keycode, modifiers: _ } => {
                    let mac_key = vk_to_mac_keycode(*keycode);
                    // 更新修飾鍵按住狀態（55=Cmd, 56=Shift, 58=Alt, 59=Ctrl）
                    match mac_key {
                        55 => MOD_CMD_DOWN.store(true, Ordering::Relaxed),
                        56 => MOD_SHIFT_DOWN.store(true, Ordering::Relaxed),
                        58 => MOD_ALT_DOWN.store(true, Ordering::Relaxed),
                        59 => MOD_CTRL_DOWN.store(true, Ordering::Relaxed),
                        _ => {}
                    }
                    let event = CGEvent::new_keyboard_event(source, mac_key, true)
                        .map_err(|_| CoreError::SystemError("建立 macOS 鍵盤按下事件失敗".to_string()))?;
                    // 一般按鍵套用目前按住的修飾鍵 flag，讓 ⌘C/⌘V 等組合鍵生效
                    // （修飾鍵本身也帶上 flag，符合真實鍵盤行為）
                    event.set_flags(current_mod_flags());
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::KeyUp { keycode, modifiers: _ } => {
                    let mac_key = vk_to_mac_keycode(*keycode);
                    match mac_key {
                        55 => MOD_CMD_DOWN.store(false, Ordering::Relaxed),
                        56 => MOD_SHIFT_DOWN.store(false, Ordering::Relaxed),
                        58 => MOD_ALT_DOWN.store(false, Ordering::Relaxed),
                        59 => MOD_CTRL_DOWN.store(false, Ordering::Relaxed),
                        _ => {}
                    }
                    let event = CGEvent::new_keyboard_event(source, mac_key, false)
                        .map_err(|_| CoreError::SystemError("建立 macOS 鍵盤放開事件失敗".to_string()))?;
                    event.set_flags(current_mod_flags());
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::MouseRelativeMove { dx, dy } => {
                    // 為了保留 macOS 的滑鼠加速度，我們取當前座標疊加 dx/dy 後注入，同時設定 DeltaX/Y
                    let event = CGEvent::new(source.clone());
                    if event.is_err() {
                        return Err(CoreError::SystemError("無法獲取當前滑鼠位置".to_string()));
                    }
                    let current_point = event.unwrap().location();
                    let point = core_graphics::geometry::CGPoint::new(current_point.x + *dx as f64, current_point.y + *dy as f64);
                    
                    let mut event_type = CGEventType::MouseMoved;
                    let mut mouse_btn = CGMouseButton::Left;
                    
                    if LEFT_BTN_DOWN.load(Ordering::Relaxed) {
                        event_type = CGEventType::LeftMouseDragged;
                    } else if RIGHT_BTN_DOWN.load(Ordering::Relaxed) {
                        event_type = CGEventType::RightMouseDragged;
                        mouse_btn = CGMouseButton::Right;
                    }
                    
                    let event = CGEvent::new_mouse_event(source, event_type, point, mouse_btn)
                        .map_err(|_| CoreError::SystemError("建立 macOS 滑鼠相對移動事件失敗".to_string()))?;
                    
                    // 寫入底層的 Event Delta，讓 macOS 得以計算並應用滑鼠加速度曲線
                    event.set_integer_value_field(core_graphics::event::EventField::MOUSE_EVENT_DELTA_X, *dx as i64);
                    event.set_integer_value_field(core_graphics::event::EventField::MOUSE_EVENT_DELTA_Y, *dy as i64);
                    event.post(CGEventTapLocation::HID);
                }
                InputEvent::TextInput { text } => {
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
                        // macOS limits Unicode string to 20 characters per event
                        for chunk in utf16.chunks(20) {
                            // KeyDown (使用 0 代表 dummy keycode，因為 0xFFFF 在某些 macOS版本會導致 CoreGraphics 崩潰)
                            if let Ok(event_down) = CGEvent::new_keyboard_event(source.clone(), 0, true) {
                                CGEventKeyboardSetUnicodeString(
                                    event_down.as_ptr() as *mut _,
                                    chunk.len() as libc::size_t,
                                    chunk.as_ptr(),
                                );
                                event_down.post(CGEventTapLocation::HID);
                            }
                            
                            // KeyUp
                            if let Ok(event_up) = CGEvent::new_keyboard_event(source.clone(), 0, false) {
                                CGEventKeyboardSetUnicodeString(
                                    event_up.as_ptr() as *mut _,
                                    chunk.len() as libc::size_t,
                                    chunk.as_ptr(),
                                );
                                event_up.post(CGEventTapLocation::HID);
                            }
                        }
                    }
                }
                InputEvent::PenMove { x, y, pressure, tilt_x, tilt_y } => {
                    // Apple Pencil / 觸控筆壓力感應：以 CGEvent 合成帶壓力的 Tablet 事件
                    // kCGMouseEventSubtype = 38, NSTabletPointEventSubtype = 1
                    // kCGTabletEventPointPressure = 14 (0-65535)
                    // kCGTabletEventTiltX = 15, kCGTabletEventTiltY = 16 (-32767..32767)
                    let tx = TARGET_MONITOR_X.load(Ordering::Relaxed);
                    let ty = TARGET_MONITOR_Y.load(Ordering::Relaxed);
                    let tw = TARGET_MONITOR_W.load(Ordering::Relaxed);
                    let th = TARGET_MONITOR_H.load(Ordering::Relaxed);
                    let point = if tw > 0 && th > 0 {
                        core_graphics::geometry::CGPoint::new(
                            tx as f64 + *x as f64 * tw as f64,
                            ty as f64 + *y as f64 * th as f64,
                        )
                    } else {
                        core_graphics::geometry::CGPoint::new(*x as f64 * screen_w, *y as f64 * screen_h)
                    };
                    set_global_cursor(*x, *y);

                    let evt_type = if LEFT_BTN_DOWN.load(Ordering::Relaxed) {
                        CGEventType::LeftMouseDragged
                    } else {
                        CGEventType::MouseMoved
                    };
                    if let Ok(event) = CGEvent::new_mouse_event(source, evt_type, point, CGMouseButton::Left) {
                        // NSTabletPointEventSubtype = 1，讓 macOS app 識別為觸控筆事件
                        event.set_integer_value_field(core_graphics::event::EventField::MOUSE_EVENT_SUB_TYPE, 1);
                        // TABLET_EVENT_POINT_PRESSURE (crate field 19): 0-65535
                        event.set_integer_value_field(core_graphics::event::EventField::TABLET_EVENT_POINT_PRESSURE, *pressure as i64);
                        // TABLET_EVENT_TILT_X/Y (fields 20/21): map i8 -90..90 → -32767..32767
                        let tilt_x_val = (*tilt_x as i64) * 32767 / 90;
                        let tilt_y_val = (*tilt_y as i64) * 32767 / 90;
                        event.set_integer_value_field(core_graphics::event::EventField::TABLET_EVENT_TILT_X, tilt_x_val);
                        event.set_integer_value_field(core_graphics::event::EventField::TABLET_EVENT_TILT_Y, tilt_y_val);
                        event.post(CGEventTapLocation::HID);
                    }
                }
                InputEvent::ResetState => {
                    // 重置滑鼠狀態
                    LEFT_BTN_DOWN.store(false, Ordering::Relaxed);
                    RIGHT_BTN_DOWN.store(false, Ordering::Relaxed);

                    // 釋放滑鼠按鍵
                    let event = CGEvent::new(source.clone());
                    if event.is_err() {
                        return Err(CoreError::SystemError("無法獲取當前滑鼠位置".to_string()));
                    }
                    let current_point = event.unwrap().location();
                    if let Ok(event_lup) = CGEvent::new_mouse_event(source.clone(), CGEventType::LeftMouseUp, current_point, CGMouseButton::Left) {
                        event_lup.post(CGEventTapLocation::HID);
                    }
                    if let Ok(event_rup) = CGEvent::new_mouse_event(source.clone(), CGEventType::RightMouseUp, current_point, CGMouseButton::Right) {
                        event_rup.post(CGEventTapLocation::HID);
                    }
                    if let Ok(event_mup) = CGEvent::new_mouse_event(source.clone(), CGEventType::OtherMouseUp, current_point, CGMouseButton::Center) {
                        event_mup.post(CGEventTapLocation::HID);
                    }

                    // 清除修飾鍵追蹤狀態，避免斷線後殘留造成後續按鍵誤帶 flag
                    MOD_CMD_DOWN.store(false, Ordering::Relaxed);
                    MOD_SHIFT_DOWN.store(false, Ordering::Relaxed);
                    MOD_ALT_DOWN.store(false, Ordering::Relaxed);
                    MOD_CTRL_DOWN.store(false, Ordering::Relaxed);

                    // 釋放修飾鍵
                    // macOS Command (55), Shift (56), Option (58), Control (59)
                    let mac_keys_to_release = [55, 56, 58, 59];
                    for &key in &mac_keys_to_release {
                        if let Ok(event) = CGEvent::new_keyboard_event(source.clone(), key, false) {
                            event.post(CGEventTapLocation::HID);
                        }
                    }
                    return Ok(());
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

    /// 重連時序號計數器重置的判定門檻：若收到的序號比目前最新序號低超過此值，
    /// 視為「client 重新連線、計數器歸零」而非重放攻擊（重放封包的序號會貼近 last_seq）。
    const SEQ_RESET_THRESHOLD: u32 = 256;

    /// 驗證封包安全性，防禦重放與過期封包。
    /// 回傳 Ok 表示放行；呼叫端應以 `sequence_number` 更新 last_seq。
    pub fn verify(&self, last_seq: u32) -> Result<(), CoreError> {
        // 正常情況：序號嚴格遞增
        if self.sequence_number > last_seq {
            return Ok(());
        }

        // 重連容錯：iOS/行動端斷線重連後，client 端序號計數器會歸零重新遞增，
        // 但 host 端若因為舊 session 洩漏而殘留高 last_seq，會把新連線的低序號
        // 封包全部誤判為重放而靜默丟棄（症狀：重連後點擊完全失效、移動正常）。
        // 判定：序號遠低於 last_seq（落差 > 門檻）→ 視為計數器重置，放行。
        // 重放攻擊的封包序號會貼近 last_seq，落在門檻內仍會被擋下。
        if last_seq.saturating_sub(self.sequence_number) > Self::SEQ_RESET_THRESHOLD {
            return Ok(());
        }

        Err(CoreError::NetworkError(format!(
            "重放攻擊防禦：序號未遞增或過期 (收到: {}, 當前最新: {})",
            self.sequence_number, last_seq
        )))
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn monitor_enum_proc(
    hmonitor: windows_sys::Win32::Graphics::Gdi::HMONITOR,
    _hdc: windows_sys::Win32::Graphics::Gdi::HDC,
    _rect: *mut windows_sys::Win32::Foundation::RECT,
    data: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::BOOL {
    let monitors = &mut *(data as *mut Vec<windows_sys::Win32::Graphics::Gdi::HMONITOR>);
    monitors.push(hmonitor);
    1 // TRUE to continue enumeration
}

#[cfg(target_os = "windows")]
pub fn get_monitor_bounds(index: usize) -> Option<(i32, i32, i32, i32)> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetMonitorInfoW, MONITORINFO};
    use windows_sys::Win32::Graphics::Gdi::EnumDisplayMonitors;
    use std::mem::size_of;

    unsafe {
        let mut monitors: Vec<windows_sys::Win32::Graphics::Gdi::HMONITOR> = Vec::new();
        let data = &mut monitors as *mut _ as windows_sys::Win32::Foundation::LPARAM;
        if EnumDisplayMonitors(0, std::ptr::null(), Some(monitor_enum_proc), data) != 0 {
            if let Some(&hmonitor) = monitors.get(index) {
                let mut info: MONITORINFO = std::mem::zeroed();
                info.cbSize = size_of::<MONITORINFO>() as u32;
                if GetMonitorInfoW(hmonitor, &mut info) != 0 {
                    let left = info.rcMonitor.left;
                    let top = info.rcMonitor.top;
                    let width = info.rcMonitor.right - info.rcMonitor.left;
                    let height = info.rcMonitor.bottom - info.rcMonitor.top;
                    return Some((left, top, width, height));
                }
            }
        }
    }
    None
}
