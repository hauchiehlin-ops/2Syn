use crate::CoreError;

/// Windows IDD (Indirect Display Driver) 虛擬顯示卡驅動控制封裝
pub struct VirtualDisplayManager;

impl VirtualDisplayManager {
    /// 插入一個指定解析度與畫面更新率的虛擬螢幕
    pub fn plug_monitor(index: u32, width: u32, height: u32, refresh_rate: u32) -> Result<(), CoreError> {
        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::Storage::FileSystem::*;
            use windows_sys::Win32::System::IO::DeviceIoControl;
            use windows_sys::Win32::Foundation::*;
            use std::ptr::null_mut;

            // 虛擬顯卡驅動控制 IOCTL 常數定義
            // 實務上這需要與 C++ IDD 驅動標頭檔定義的 CTL_CODE 一致
            const FILE_DEVICE_UNKNOWN: u32 = 0x00000022;
            const METHOD_BUFFERED: u32 = 0;
            const FILE_ANY_ACCESS: u32 = 0;
            
            macro_rules! ctl_code {
                ($device_type:expr, $function:expr, $method:expr, $access:expr) => {
                    ($device_type << 16) | ($access << 14) | ($function << 2) | $method
                };
            }

            let ioctl_plug = ctl_code!(FILE_DEVICE_UNKNOWN, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS);

            // 定義發送給驅動的控制緩衝區結構
            #[repr(C)]
            struct MonitorConfig {
                connector_index: u32,
                width: u32,
                height: u32,
                refresh_rate: u32,
            }

            let config = MonitorConfig {
                connector_index: index,
                width,
                height,
                refresh_rate,
            };

            unsafe {
                // 開啟 IddSampleDriver 裝置的符號連結符
                // 寬字元路徑: \\\\.\\IddSampleDriverDevice
                let device_path: Vec<u16> = "\\\\.\\IddSampleDriverDevice\0"
                    .encode_utf16()
                    .collect();

                let handle = CreateFileW(
                    device_path.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    null_mut(),
                    OPEN_EXISTING,
                    0,
                    0,
                );

                if handle == INVALID_HANDLE_VALUE {
                    return Err(CoreError::SystemError(
                        "無法連接虛擬顯示卡驅動。請確認 IDD 驅動是否已安裝且正常運作。".to_string()
                    ));
                }

                let mut bytes_returned: u32 = 0;
                let success = DeviceIoControl(
                    handle,
                    ioctl_plug,
                    &config as *const _ as *const _,
                    std::mem::size_of::<MonitorConfig>() as u32,
                    null_mut(),
                    0,
                    &mut bytes_returned,
                    null_mut(),
                );

                CloseHandle(handle);

                if success == 0 {
                    return Err(CoreError::SystemError("IDD 驅動拒絕了插入虛擬螢幕的 IOCTL 請求".to_string()));
                }
            }
            Ok(())
        }

        #[cfg(not(target_os = "windows"))]
        {
            // 非 Windows 平台 (如 macOS / iOS / Android)
            // 在 macOS 上可以透過自訂 DisplayLink 驅動或 CoreGraphics 虛擬螢幕 API
            // 本處做為 Stub，回傳模擬成功
            println!(
                "非 Windows 平台模擬：插入虛擬螢幕 #{}，解析度: {}x{}，更新率: {}Hz",
                index, width, height, refresh_rate
            );
            Ok(())
        }
    }

    /// 拔除指定的虛擬螢幕
    pub fn unplug_monitor(index: u32) -> Result<(), CoreError> {
        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::Storage::FileSystem::*;
            use windows_sys::Win32::System::IO::DeviceIoControl;
            use windows_sys::Win32::Foundation::*;
            use std::ptr::null_mut;

            const FILE_DEVICE_UNKNOWN: u32 = 0x00000022;
            const METHOD_BUFFERED: u32 = 0;
            const FILE_ANY_ACCESS: u32 = 0;
            
            macro_rules! ctl_code {
                ($device_type:expr, $function:expr, $method:expr, $access:expr) => {
                    ($device_type << 16) | ($access << 14) | ($function << 2) | $method
                };
            }

            let ioctl_unplug = ctl_code!(FILE_DEVICE_UNKNOWN, 0x802, METHOD_BUFFERED, FILE_ANY_ACCESS);

            unsafe {
                let device_path: Vec<u16> = "\\\\.\\IddSampleDriverDevice\0"
                    .encode_utf16()
                    .collect();

                let handle = CreateFileW(
                    device_path.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    null_mut(),
                    OPEN_EXISTING,
                    0,
                    0,
                );

                if handle == INVALID_HANDLE_VALUE {
                    return Err(CoreError::SystemError("無法連接虛擬顯示卡驅動".to_string()));
                }

                let mut bytes_returned: u32 = 0;
                let success = DeviceIoControl(
                    handle,
                    ioctl_unplug,
                    &index as *const _ as *const _,
                    std::mem::size_of::<u32>() as u32,
                    null_mut(),
                    0,
                    &mut bytes_returned,
                    null_mut(),
                );

                CloseHandle(handle);

                if success == 0 {
                    return Err(CoreError::SystemError("IDD 驅動拒絕了拔除虛擬螢幕的 IOCTL 請求".to_string()));
                }
            }
            Ok(())
        }

        #[cfg(not(target_os = "windows"))]
        {
            println!("非 Windows 平台模擬：拔除虛擬螢幕 #{}", index);
            Ok(())
        }
    }
}
