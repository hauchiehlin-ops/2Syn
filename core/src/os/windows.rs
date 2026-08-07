#[cfg(target_os = "windows")]
pub fn switch_to_input_desktop() -> Result<(), String> {
    use windows_sys::Win32::System::StationsAndDesktops::{
        OpenInputDesktop, SetThreadDesktop, CloseDesktop
    };
    use windows_sys::Win32::Foundation::{GetLastError, MAXIMUM_ALLOWED};
    use log::{info, error};

    unsafe {
        // MAXIMUM_ALLOWED: 0x02000000
        let h_desktop = OpenInputDesktop(0, 0, MAXIMUM_ALLOWED);
        if h_desktop == 0 {
            let err = GetLastError();
            error!("OpenInputDesktop failed with error code: {}", err);
            return Err(format!("OpenInputDesktop failed: {}", err));
        }

        info!("Successfully opened input desktop.");

        if SetThreadDesktop(h_desktop) == 0 {
            let err = GetLastError();
            error!("SetThreadDesktop failed with error code: {}", err);
            CloseDesktop(h_desktop);
            return Err(format!("SetThreadDesktop failed: {}", err));
        }

        info!("Successfully switched thread to input desktop.");

        // We leave the desktop handle open because the thread needs to use it,
        // but typically Windows will clean it up or we can close it when the thread exits.
        // Wait, CloseDesktop fails if the desktop is the calling thread's current desktop.
        // So we just shouldn't close it immediately. 
    }
    Ok(())
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug)]
#[repr(C)]
struct SynVhidKeyboardReport {
    modifier: u8,
    reserved: u8,
    keys: [u8; 6],
}

#[cfg(target_os = "windows")]
const IOCTL_2SYNVHID_SUBMIT_KEYBOARD_REPORT: u32 = (0x0000_0022 << 16) | (0x0002 << 14) | (0x0801 << 2);

#[cfg(target_os = "windows")]
fn open_vhid_device() -> Result<windows_sys::Win32::Foundation::HANDLE, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{GetLastError, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    let path: Vec<u16> = std::ffi::OsStr::new(r"\\.\2synvhid")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            windows_sys::Win32::Storage::FileSystem::GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            0,
        )
    };

    if handle == INVALID_HANDLE_VALUE {
        Err(format!(
            "2syn virtual HID driver is not available (CreateFileW error {}). Install windows-vhid and run the host with access to \\\\.\\2synvhid.",
            unsafe { GetLastError() }
        ))
    } else {
        Ok(handle)
    }
}

#[cfg(target_os = "windows")]
fn submit_vhid_report(
    handle: windows_sys::Win32::Foundation::HANDLE,
    report: SynVhidKeyboardReport,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::System::IO::DeviceIoControl;

    let mut bytes_returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_2SYNVHID_SUBMIT_KEYBOARD_REPORT,
            &report as *const _ as *mut _,
            std::mem::size_of::<SynVhidKeyboardReport>() as u32,
            std::ptr::null_mut(),
            0,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };

    if ok == 0 {
        Err(format!(
            "2syn virtual HID report rejected (DeviceIoControl error {})",
            unsafe { GetLastError() }
        ))
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn ascii_to_hid_usage(ch: char) -> Option<(u8, u8)> {
    const SHIFT: u8 = 0x02;
    match ch {
        'a'..='z' => Some((0, 0x04 + (ch as u8 - b'a'))),
        'A'..='Z' => Some((SHIFT, 0x04 + (ch as u8 - b'A'))),
        '1'..='9' => Some((0, 0x1e + (ch as u8 - b'1'))),
        '0' => Some((0, 0x27)),
        '\n' | '\r' => Some((0, 0x28)),
        '\t' => Some((0, 0x2b)),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn send_vhid_key(
    handle: windows_sys::Win32::Foundation::HANDLE,
    modifier: u8,
    usage: u8,
) -> Result<(), String> {
    submit_vhid_report(
        handle,
        SynVhidKeyboardReport {
            modifier,
            reserved: 0,
            keys: [usage, 0, 0, 0, 0, 0],
        },
    )?;
    std::thread::sleep(std::time::Duration::from_millis(28));
    submit_vhid_report(
        handle,
        SynVhidKeyboardReport {
            modifier: 0,
            reserved: 0,
            keys: [0; 6],
        },
    )?;
    std::thread::sleep(std::time::Duration::from_millis(28));
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_vhid_text(
    handle: windows_sys::Win32::Foundation::HANDLE,
    text: &str,
) -> Result<(), String> {
    for ch in text.chars() {
        let (modifier, usage) = ascii_to_hid_usage(ch).ok_or_else(|| {
            format!(
                "Character {:?} cannot be sent through the stable Windows lock-screen HID backend. Use only A-Z, a-z, and 0-9 for unattended Windows lock-screen credentials.",
                ch
            )
        })?;
        send_vhid_key(handle, modifier, usage)?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn type_windows_login_with_vhid(
    username: Option<&str>,
    login_password: &str,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;

    let handle = open_vhid_device()?;
    let result = (|| {
        send_vhid_key(handle, 0, 0x28)?;
        std::thread::sleep(std::time::Duration::from_millis(500));

        if let Some(name) = username.filter(|s| !s.trim().is_empty()) {
            send_vhid_text(handle, name)?;
            send_vhid_key(handle, 0, 0x2b)?;
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        send_vhid_text(handle, login_password)?;
        std::thread::sleep(std::time::Duration::from_millis(100));
        send_vhid_key(handle, 0, 0x28)
    })();

    unsafe {
        CloseHandle(handle);
    }

    result
}

#[cfg(target_os = "windows")]
pub fn is_vhid_available() -> bool {
    match open_vhid_device() {
        Ok(handle) => {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(handle);
            }
            true
        }
        Err(_) => false,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn switch_to_input_desktop() -> Result<(), String> {
    Ok(())
}
