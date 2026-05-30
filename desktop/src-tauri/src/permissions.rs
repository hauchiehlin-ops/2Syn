#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;
#[cfg(target_os = "macos")]
use core_foundation::boolean::CFBoolean;
#[cfg(target_os = "macos")]
use core_foundation::string::CFString;
#[cfg(target_os = "macos")]
use std::ffi::c_void;

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
pub fn check_and_request_permissions() -> bool {
    let mut all_granted = true;

    unsafe {
        // 1. Check Screen Recording
        // macOS 10.15+ API
        let screen_granted = CGPreflightScreenCaptureAccess();
        if !screen_granted {
            // This triggers the native prompt
            CGRequestScreenCaptureAccess();
            all_granted = false;
        }

        // 2. Check Accessibility
        // kAXTrustedCheckOptionPrompt specifies whether to prompt the user
        let options = core_foundation::dictionary::CFDictionary::from_CFType_pairs(&[(
            CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt as _),
            CFBoolean::true_value().as_CFType(),
        )]);

        let ax_granted = AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as _);
        if !ax_granted {
            all_granted = false;
        }
    }

    all_granted
}

#[cfg(not(target_os = "macos"))]
pub fn check_and_request_permissions() -> bool {
    true
}
