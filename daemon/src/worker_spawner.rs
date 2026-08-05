#[cfg(windows)]
use log::{error, info};
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
pub fn spawn_worker_in_active_session() -> Result<u32, String> {
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSGetActiveConsoleSessionId, WTSQueryUserToken,
    };
    use windows_sys::Win32::Security::{
        DuplicateTokenEx, SecurityIdentification, SecurityImpersonation,
        TokenPrimary, TOKEN_ALL_ACCESS, SECURITY_ATTRIBUTES,
    };
    use windows_sys::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
    use windows_sys::Win32::System::Threading::{
        CreateProcessAsUserW, PROCESS_INFORMATION, STARTUPINFOW, CREATE_UNICODE_ENVIRONMENT,
    };
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};

    unsafe {
        let session_id = WTSGetActiveConsoleSessionId();
        if session_id == 0xFFFFFFFF {
            return Err("No active console session found".to_string());
        }

        info!("Active Console Session ID: {}", session_id);

        let mut token: HANDLE = INVALID_HANDLE_VALUE;
        if WTSQueryUserToken(session_id, &mut token) == 0 {
            return Err(format!("WTSQueryUserToken failed. Error: {}", std::io::Error::last_os_error()));
        }

        let mut duplicate_token: HANDLE = INVALID_HANDLE_VALUE;
        let mut sa: SECURITY_ATTRIBUTES = std::mem::zeroed();
        sa.nLength = std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32;

        if DuplicateTokenEx(
            token,
            TOKEN_ALL_ACCESS,
            &mut sa,
            SecurityIdentification,
            TokenPrimary,
            &mut duplicate_token,
        ) == 0 {
            CloseHandle(token);
            return Err(format!("DuplicateTokenEx failed. Error: {}", std::io::Error::last_os_error()));
        }

        let mut env_block: *mut std::ffi::c_void = std::ptr::null_mut();
        if CreateEnvironmentBlock(&mut env_block, duplicate_token, 0) == 0 {
            CloseHandle(duplicate_token);
            CloseHandle(token);
            return Err(format!("CreateEnvironmentBlock failed. Error: {}", std::io::Error::last_os_error()));
        }

        let mut startup_info: STARTUPINFOW = std::mem::zeroed();
        startup_info.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        startup_info.lpDesktop = "winsta0\\default\0".encode_utf16().collect::<Vec<u16>>().as_mut_ptr();
        
        let mut process_info: PROCESS_INFORMATION = std::mem::zeroed();

        // Get current executable path
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut command_line: Vec<u16> = format!("\"{}\" --worker\0", exe_path.display())
            .encode_utf16()
            .collect();

        if CreateProcessAsUserW(
            duplicate_token,
            std::ptr::null(),
            command_line.as_mut_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            CREATE_UNICODE_ENVIRONMENT,
            env_block,
            std::ptr::null(),
            &mut startup_info,
            &mut process_info,
        ) == 0 {
            let err = std::io::Error::last_os_error();
            DestroyEnvironmentBlock(env_block);
            CloseHandle(duplicate_token);
            CloseHandle(token);
            return Err(format!("CreateProcessAsUserW failed. Error: {}", err));
        }

        info!("Successfully spawned worker in Session {}", session_id);

        CloseHandle(process_info.hThread);
        let pid = process_info.dwProcessId;
        // Keep hProcess open if we want to wait on it, else close it
        CloseHandle(process_info.hProcess);

        DestroyEnvironmentBlock(env_block);
        CloseHandle(duplicate_token);
        CloseHandle(token);

        Ok(pid)
    }
}

#[cfg(not(windows))]
pub fn spawn_worker_in_active_session() -> Result<u32, String> {
    use std::process::Command;
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    
    let mut cmd = Command::new(&exe_path);
    
    // Check if we are running as root
    let is_root = {
        let out = Command::new("id").arg("-u").output();
        if let Ok(output) = out {
            let uid_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            uid_str == "0"
        } else {
            false
        }
    };
    
    if is_root {
        // Try to find the UID of the user currently logged into the console
        if let Ok(output) = Command::new("stat").args(&["-f", "%u", "/dev/console"]).output() {
            let console_uid = String::from_utf8_lossy(&output.stdout).trim().to_string();
            
            // If the console is owned by a real user (not root)
            if !console_uid.is_empty() && console_uid != "0" {
                log::info!("Dropping privileges. Running worker as UID {}", console_uid);
                // Use launchctl asuser to run in that user's session context
                cmd = Command::new("launchctl");
                cmd.args(&["asuser", &console_uid, exe_path.to_str().unwrap()]);
            }
        }
    }
    
    let child = cmd
        .arg("--worker")
        .spawn()
        .map_err(|e| format!("Failed to spawn worker: {}", e))?;
    
    Ok(child.id())
}
