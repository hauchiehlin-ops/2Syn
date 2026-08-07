#[cfg(target_os = "macos")]
pub fn wake_display() -> Result<(), String> {
    // 透過 caffeinate -u -t 5 模擬使用者活動，立即喚醒休眠的顯示器與背光
    let _ = std::process::Command::new("/usr/bin/caffeinate")
        .args(["-u", "-t", "5"])
        .spawn();
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn type_macos_login(_username: Option<&str>, login_password: &str) -> Result<(), String> {
    // 1. 喚醒螢幕
    let _ = wake_display();
    std::thread::sleep(std::time::Duration::from_millis(300));

    // 2. 透過 osascript System Events 發送 keystroke
    let escaped_pwd = login_password.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "tell application \"System Events\"\n  keystroke \"{}\"\n  delay 0.1\n  key code 36\nend tell",
        escaped_pwd
    );
    let output = std::process::Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            log::info!("[macOS Login] osascript keystroke sent successfully.");
            Ok(())
        }
        Ok(out) => {
            let err_msg = String::from_utf8_lossy(&out.stderr);
            log::warn!("[macOS Login] osascript failed: {}, falling back to CGEvent", err_msg);
            type_macos_login_cgevent(login_password)
        }
        Err(e) => {
            log::warn!("[macOS Login] osascript execution failed: {}, falling back to CGEvent", e);
            type_macos_login_cgevent(login_password)
        }
    }
}

#[cfg(target_os = "macos")]
fn type_macos_login_cgevent(password: &str) -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "無法建立 CGEventSource".to_string())?;

    for ch in password.chars() {
        let mut buf = [0u16; 2];
        let utf16_str = ch.encode_utf16(&mut buf);
        let utf16_slice: &[u16] = &*utf16_str;

        extern "C" {
            fn CGEventKeyboardSetUnicodeString(
                event: core_graphics::sys::CGEventRef,
                length: libc::size_t,
                string: *const u16,
            );
        }
        use foreign_types_shared::ForeignType;

        if let Ok(event_down) = CGEvent::new_keyboard_event(source.clone(), 0, true) {
            unsafe {
                CGEventKeyboardSetUnicodeString(
                    event_down.as_ptr(),
                    utf16_slice.len() as libc::size_t,
                    utf16_slice.as_ptr(),
                );
            }
            event_down.post(CGEventTapLocation::HID);
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
        if let Ok(event_up) = CGEvent::new_keyboard_event(source.clone(), 0, false) {
            unsafe {
                CGEventKeyboardSetUnicodeString(
                    event_up.as_ptr(),
                    utf16_slice.len() as libc::size_t,
                    utf16_slice.as_ptr(),
                );
            }
            event_up.post(CGEventTapLocation::HID);
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    // 按下 Enter (Return key code 36)
    if let Ok(event_down) = CGEvent::new_keyboard_event(source.clone(), 36, true) {
        event_down.post(CGEventTapLocation::HID);
    }
    std::thread::sleep(std::time::Duration::from_millis(30));
    if let Ok(event_up) = CGEvent::new_keyboard_event(source, 36, false) {
        event_up.post(CGEventTapLocation::HID);
    }

    Ok(())
}
