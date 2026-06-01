// Prevents additional console window on Windows in release, do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        let log_msg = format!("Panic occurred: {:?}\nBacktrace:\n{:?}", info, backtrace);
        // Write to user's home directory so they can find it easily
        if let Some(home_dir) = std::env::var_os("HOME") {
            let mut path = std::path::PathBuf::from(home_dir);
            path.push("Desktop");
            path.push("2syn-panic.log");
            let _ = std::fs::write(&path, log_msg.clone());
        }
        eprintln!("{}", log_msg);
    }));

    syn_desktop::run()
}
