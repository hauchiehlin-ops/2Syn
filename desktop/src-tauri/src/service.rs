use tauri::command;
use std::process::Command;

#[cfg(target_os = "macos")]
fn get_elevated_command(cmd: &str) -> Command {
    let mut c = Command::new("osascript");
    c.arg("-e").arg(format!("do shell script \"{}\" with administrator privileges", cmd));
    c
}

#[cfg(target_os = "windows")]
fn get_elevated_command(cmd: &str) -> Command {
    let mut c = Command::new("powershell");
    c.arg("-Command")
     .arg(format!("Start-Process cmd -ArgumentList '/c {}' -Verb RunAs", cmd));
    c
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn get_elevated_command(cmd: &str) -> Command {
    let mut c = Command::new("sh");
    c.arg("-c").arg(cmd);
    c
}

#[command]
pub async fn install_service() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let daemon_path = exe_path.parent().unwrap().join("2syn-daemon");
        
        let script = format!(r#"
            cat << 'EOF' > /tmp/com.2syn.daemon.plist
<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
    <key>Label</key>
    <string>com.2syn.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF
            cp /tmp/com.2syn.daemon.plist /Library/LaunchDaemons/
            launchctl load -w /Library/LaunchDaemons/com.2syn.daemon.plist
        "#, daemon_path.display());
        
        let output = get_elevated_command(&script)
            .output()
            .map_err(|e| e.to_string())?;
        
        if output.status.success() {
            Ok("Service installed and started".to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).into_owned())
        }
    }

    #[cfg(target_os = "windows")]
    {
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let daemon_path = exe_path.parent().unwrap().join("2syn-daemon.exe");
        
        let script = format!("sc create 2SynDaemon binPath= \\\"{}\\\" start= auto && sc start 2SynDaemon", daemon_path.display());
        let output = get_elevated_command(&script)
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            Ok("Windows Service installed and started".to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).into_owned())
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok("Not implemented for this OS".to_string())
    }
}

#[command]
pub async fn uninstall_service() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let script = "launchctl unload -w /Library/LaunchDaemons/com.2syn.daemon.plist && rm /Library/LaunchDaemons/com.2syn.daemon.plist";
        let output = get_elevated_command(script)
            .output()
            .map_err(|e| e.to_string())?;
            
        if output.status.success() {
            Ok("Service uninstalled".to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).into_owned())
        }
    }

    #[cfg(target_os = "windows")]
    {
        let script = "sc stop 2SynDaemon && sc delete 2SynDaemon";
        let output = get_elevated_command(script)
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            Ok("Windows Service uninstalled".to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).into_owned())
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok("Not implemented for this OS".to_string())
    }
}
