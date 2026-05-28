use core_graphics::event::{CGEvent, CGEventSource, CGEventSourceStateID, CGEventTapLocation};

fn main() {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
    if let Ok(event) = CGEvent::new_keyboard_event(&source, 0, true) {
        // test if set_string exists
        event.set_string("中");
        event.post(CGEventTapLocation::HID);
        println!("set_string ok");
    }
}
