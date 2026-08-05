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

#[cfg(not(target_os = "windows"))]
pub fn switch_to_input_desktop() -> Result<(), String> {
    Ok(())
}
