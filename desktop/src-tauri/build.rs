fn main() {
    let git_commit = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=SYN_GIT_COMMIT={}", git_commit);

    let build_time = std::process::Command::new("git")
        .args(["show", "-s", "--format=%cI", "HEAD"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=SYN_BUILD_TIME={}", build_time);

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        // 解決 macOS 上載入 libswift_Concurrency.dylib 缺少 LC_RPATH 的啟動崩潰問題：
        // 加入系統 Swift 庫與 App Bundle Frameworks 的搜尋路徑。
        println!("rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        println!("rustc-link-arg=-Wl,-rpath,@loader_path/../Frameworks");
    }
    tauri_build::build()
}
