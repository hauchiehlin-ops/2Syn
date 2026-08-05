use log::{info, error};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

mod worker_spawner;

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "action")]
enum IpcCommand {
    Status,
    Restart,
    Shutdown,
}

#[derive(Serialize, Deserialize, Debug)]
struct IpcResponse {
    status: String,
}

#[cfg(unix)]
async fn run_ipc_server() -> Result<(), Box<dyn std::error::Error>> {
    use tokio::net::UnixListener;
    use std::fs;

    let socket_path = "/tmp/2syn-daemon.sock";
    let _ = fs::remove_file(socket_path);

    let listener = UnixListener::bind(socket_path)?;
    info!("Daemon IPC listening on Unix Domain Socket: {}", socket_path);

    while let Ok((mut stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let mut buf = vec![0; 1024];
            if let Ok(n) = stream.read(&mut buf).await {
                if n > 0 {
                    if let Ok(text) = String::from_utf8(buf[..n].to_vec()) {
                        if let Ok(cmd) = serde_json::from_str::<IpcCommand>(&text) {
                            info!("Received command: {:?}", cmd);
                            let resp = IpcResponse { status: "OK".to_string() };
                            if let Ok(json) = serde_json::to_string(&resp) {
                                let _ = stream.write_all(json.as_bytes()).await;
                            }
                        }
                    }
                }
            }
        });
    }
    Ok(())
}

#[cfg(windows)]
async fn run_ipc_server() -> Result<(), Box<dyn std::error::Error>> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe_name = r"\\.\pipe\2syn-daemon";
    info!("Daemon IPC listening on Named Pipe: {}", pipe_name);

    loop {
        let mut server = match ServerOptions::new().create(pipe_name) {
            Ok(server) => server,
            Err(e) => {
                error!("Failed to create named pipe server: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }
        };

        match server.connect().await {
            Ok(_) => {
                tokio::spawn(async move {
                    let mut buf = vec![0; 1024];
                    if let Ok(n) = server.read(&mut buf).await {
                        if n > 0 {
                            if let Ok(text) = String::from_utf8(buf[..n].to_vec()) {
                                if let Ok(cmd) = serde_json::from_str::<IpcCommand>(&text) {
                                    info!("Received command: {:?}", cmd);
                                    let resp = IpcResponse { status: "OK".to_string() };
                                    if let Ok(json) = serde_json::to_string(&resp) {
                                        let _ = server.write_all(json.as_bytes()).await;
                                    }
                                }
                            }
                        }
                    }
                });
            }
            Err(e) => {
                error!("Error waiting for client connection: {}", e);
            }
        }
    }
}

async fn run_worker(my_id: Option<String>, pin: Option<String>) -> Result<(), Box<dyn std::error::Error>> {
    info!("Starting worker process in Session 1...");

    #[cfg(target_os = "windows")]
    if let Err(e) = syn_core::os::windows::switch_to_input_desktop() {
        error!("Failed to switch thread desktop: {}", e);
        // Continue anyway, maybe we're already on the right desktop
    }

    let engine = std::sync::Arc::new(syn_core::engine::CoreEngine::new());
    
    // Read from System Config if args are not provided
    let config = syn_core::system_config::SystemConfig::read_config();
    let id = my_id.or(config.hwid).unwrap_or_else(|| "daemon-worker".to_string());
    
    // Using a default pin if neither args nor config has one. In reality, the daemon needs the raw pin to establish connection, 
    // but the system config only has hashed_password. The WebRtcSession only needs the pin for verifying.
    // Wait, the client sends the PIN for verification. The host (worker) just verifies it.
    // So the host actually needs to load the hashed_password.
    // For now we pass a dummy PIN if it's not set. We will adapt authentication logic later.
    let p = pin.unwrap_or_else(|| "0000".to_string());
    
    *engine.current_pin.write().await = p;

    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel::<()>();
    *engine.signaling_abort.lock().await = Some(abort_tx);

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(100);
    *engine.signaling_tx.lock().await = Some(tx);

    info!("Worker initialized. Connecting to signaling as {}...", id);
    let engine_clone = std::sync::Arc::clone(&engine);
    
    // Listen to Engine Events
    let mut event_rx = engine.subscribe_events();
    tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            match event {
                syn_core::engine::EngineEvent::IncomingOffer(source, offer_pin, sdp, session_id) => {
                    info!("Received Incoming Offer from {}", source);
                    
                    let config = syn_core::system_config::SystemConfig::read_config();
                    if let Some(hashed_pwd) = config.hashed_password {
                        let input_hashed = syn_core::system_config::SystemConfig::hash_password(&offer_pin);
                        if input_hashed == hashed_pwd {
                            info!("PIN verified for {}", source);
                            *engine.current_remote_id.write().await = source.clone();
                            match engine.setup_host_session(sdp.clone(), None).await {
                                Ok(answer_sdp) => {
                                    info!("Sending Answer to {}", source);
                                    let tx_lock = engine.signaling_tx.lock().await;
                                    if let Some(tx) = tx_lock.as_ref() {
                                        let msg = serde_json::json!({
                                            "type": "answer",
                                            "target": source,
                                            "sdp": answer_sdp,
                                            "sessionId": session_id
                                        });
                                        let _ = tx.send(msg.to_string()).await;
                                    }
                                }
                                Err(e) => {
                                    error!("Failed to setup host session: {}", e);
                                }
                            }
                        } else {
                            error!("Invalid PIN provided by {}", source);
                        }
                    } else {
                        error!("No password configured. Rejecting offer from {}", source);
                    }
                }
                syn_core::engine::EngineEvent::IncomingIce(source, candidate, _session_id) => {
                    info!("Received ICE candidate from {}", source);
                    if let Err(e) = engine.add_ice_candidate(candidate.clone()).await {
                        error!("Failed to add ICE candidate: {}", e);
                    }
                }
                syn_core::engine::EngineEvent::SignalingLog(log) => {
                    info!("Signaling Log: {}", log);
                }
                _ => {}
            }
        }
    });

    engine_clone.start_signaling_task(id, rx, abort_rx).await;

    Ok(())
}

async fn run_daemon_watchdog() -> Result<(), Box<dyn std::error::Error>> {
    info!("Starting 2syn-daemon watchdog...");

    // Start local IPC Server
    tokio::spawn(async {
        if let Err(e) = run_ipc_server().await {
            error!("IPC Server error: {}", e);
        }
    });

    let mut last_pid = None;

    loop {
        let config = syn_core::system_config::SystemConfig::read_config();
        
        if config.hashed_password.is_some() {
            // Only spawn worker if a password is set
            match worker_spawner::spawn_worker_in_active_session() {
                Ok(pid) => {
                    if Some(pid) != last_pid {
                        info!("Worker spawned with PID: {}", pid);
                        last_pid = Some(pid);
                    }
                }
                Err(e) => {
                    error!("Worker spawn failed (or no session): {}", e);
                }
            }
        } else {
            info!("No unattended password set. Watchdog idling.");
            last_pid = None; // Worker might have died or not started
        }
        
        // Check every 10 seconds. In production, use process wait.
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    }
}

// Windows Service Integration
#[cfg(windows)]
use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};

#[cfg(windows)]
define_windows_service!(ffi_service_main, my_service_main);

#[cfg(windows)]
fn my_service_main(arguments: Vec<std::ffi::OsString>) {
    if let Err(e) = run_windows_service() {
        error!("Service error: {:?}", e);
    }
}

#[cfg(windows)]
fn run_windows_service() -> Result<(), Box<dyn std::error::Error>> {
    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        match control_event {
            ServiceControl::Stop => {
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };
    
    let status_handle = service_control_handler::register("2syn-daemon", event_handler)?;
    
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: std::time::Duration::default(),
        process_id: None,
    })?;

    // Create a new Tokio runtime for the daemon
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async {
        let _ = run_daemon_watchdog().await;
    });
    
    status_handle.set_service_status(ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: std::time::Duration::default(),
        process_id: None,
    })?;

    Ok(())
}


fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();
    
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "--worker" {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(async {
            run_worker(args.get(2).cloned(), args.get(3).cloned()).await
        })?;
        return Ok(());
    }

    #[cfg(windows)]
    {
        // Try to start as a Windows Service. If it fails, fallback to console mode.
        if let Err(e) = service_dispatcher::start("2syn-daemon", ffi_service_main) {
            error!("Failed to start as Windows Service: {}. Falling back to console mode.", e);
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(async {
                run_daemon_watchdog().await
            })?;
        }
    }

    #[cfg(not(windows))]
    {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(async {
            run_daemon_watchdog().await
        })?;
    }

    Ok(())
}
