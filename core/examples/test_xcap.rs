use xcap::Monitor;

fn main() {
    println!("=== Testing xcap Screen Capture ===");
    match Monitor::all() {
        Ok(monitors) => {
            println!("Found {} monitors.", monitors.len());
            if monitors.is_empty() {
                println!("No monitors found! This usually means macOS permissions are missing or the CGGetActiveDisplayList API returned an empty list.");
                return;
            }
            for (i, monitor) in monitors.iter().enumerate() {
                println!("Monitor #{} - Name: {:?}, Width: {:?}, Height: {:?}, IsPrimary: {:?}", 
                    i, monitor.name(), monitor.width(), monitor.height(), monitor.is_primary());
                
                println!("Attempting screen capture on Monitor #{}...", i);
                match monitor.capture_image() {
                    Ok(img) => {
                        println!("Screen capture SUCCESS! Dimensions: {}x{}", img.width(), img.height());
                    }
                    Err(err) => {
                        println!("Screen capture FAILED for Monitor #{}: {:?}", i, err);
                    }
                }
            }
        }
        Err(err) => {
            println!("Error listing monitors: {:?}", err);
        }
    }
}
