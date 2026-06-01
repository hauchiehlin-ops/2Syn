#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;
#[cfg(target_os = "macos")]
use core_foundation::boolean::CFBoolean;
#[cfg(target_os = "macos")]
use core_foundation::string::CFString;
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use tauri::Manager;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    pub fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    pub static kAXTrustedCheckOptionPrompt: *const c_void;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    pub fn CGPreflightScreenCaptureAccess() -> bool;
    pub fn CGRequestScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
pub fn check_and_request_permissions(window: &tauri::Window) -> bool {
    unsafe {
        // 1. Check Screen Recording First
        let screen_granted = CGPreflightScreenCaptureAccess();
        if !screen_granted {
            // Hide window to ensure native prompt is visible and on top
            let _ = window.hide();
            
            // Triggers the native macOS Screen Recording prompt
            CGRequestScreenCaptureAccess();
            
            // Wait for user to grant and use macOS native "Quit & Reopen"
            return false;
        }

        // 2. Check Accessibility Only If Screen Recording Is Granted
        let options = core_foundation::dictionary::CFDictionary::from_CFType_pairs(&[(
            CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt as _),
            CFBoolean::true_value().as_CFType(),
        )]);

        let ax_granted = AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as _);
        if !ax_granted {
            let _ = window.hide();
            
            let app_handle = window.app_handle().clone();
            std::thread::spawn(move || {
                // Background loop to auto-detect when user checks the Accessibility box
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    
                    // Check without prompting
                    let granted = unsafe { AXIsProcessTrustedWithOptions(std::ptr::null()) };
                    if granted {
                        let script = r#"
                            tell application "System Events"
                                activate
                                display dialog "輔助使用權限設定已完成！\n\n應用程式將自動重新啟動以套用設定。" buttons {"確定"} default button "確定" with title "2syn" with icon note giving up after 5
                            end tell
                        "#;
                        let _ = std::process::Command::new("osascript").arg("-e").arg(script).status();
                        
                        // Restart the app automatically
                        app_handle.restart();
                        break;
                    }
                }
            });
            return false;
        }
        
        // Both granted, show window
        let _ = window.show();
    }

    true
}

#[cfg(not(target_os = "macos"))]
pub fn check_and_request_permissions(_window: &tauri::Window) -> bool {
    true
}
