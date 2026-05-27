use xcap::Monitor;
fn main() {
    let monitors = Monitor::all().unwrap();
    for m in monitors {
        println!("Monitor: {}x{}, position: ({}, {})", m.width(), m.height(), m.x(), m.y());
    }
}
