use core_graphics::event::{CGEvent, CGEventSource, CGEventSourceStateID, CGEventTapLocation, CGScrollEventUnit};

fn main() {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
    // CGEvent::new_scroll_event(source, units, wheelCount, wheel1)
    if let Ok(event) = CGEvent::new_scroll_event(&source, CGScrollEventUnit::PIXEL, 1, 10, 0, 0) {
        event.post(CGEventTapLocation::HID);
        println!("Scroll ok");
    }
}
