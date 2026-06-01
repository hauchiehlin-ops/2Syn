use std::time::{Instant, Duration};
use screencapturekit::shareable_content::SCShareableContent;
use screencapturekit::screenshot_manager::SCScreenshotManager;
use screencapturekit::stream::configuration::SCStreamConfiguration;
use screencapturekit::stream::content_filter::SCContentFilter;
use std::thread;

fn main() {
    println!("Testing capscreen_macos in background thread...");
    let handle = thread::spawn(move || {
        let content = SCShareableContent::get().unwrap();
        let display = content.displays().into_iter().next().unwrap();
        let filter = SCContentFilter::builder().display(&display).build();
        let config = SCStreamConfiguration::new();
        
        for i in 0..10 {
            let start = std::time::Instant::now();
            let img = SCScreenshotManager::capture_image(&filter, &config).unwrap();
            let data = img.rgba_data().unwrap();
            println!("Thread Frame {} captured in {:?}, data size: {} ({}x{})", i, start.elapsed(), data.len(), img.width(), img.height());
        }
    });
    handle.join().unwrap();
}
