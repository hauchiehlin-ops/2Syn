fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        // 解決 macOS 上載入 libswift_Concurrency.dylib 缺少 LC_RPATH 的啟動崩潰問題：
        // 加入系統 Swift 庫與 App Bundle Frameworks 的搜尋路徑。
        println!("rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        println!("rustc-link-arg=-Wl,-rpath,@loader_path/../Frameworks");
    }
    tauri_build::build()
}
