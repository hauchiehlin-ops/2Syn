use openh264::encoder::{Encoder, EncoderConfig};
use xcap::Monitor;

fn main() {
    let monitors = Monitor::all().unwrap();
    if monitors.is_empty() {
        println!("No monitors found");
        return;
    }
    let monitor = &monitors[0];
    println!("Monitor: {}x{}", monitor.width().unwrap(), monitor.height().unwrap());

    let image = monitor.capture_image().unwrap();
    println!("Captured image: {}x{}", image.width(), image.height());

    let config = EncoderConfig::new();
    let api = openh264::OpenH264API::from_source();
    let mut encoder = Encoder::with_api_config(api, config).unwrap();
    
    let width = image.width() as usize;
    let height = image.height() as usize;
    let adj_width = if width % 2 != 0 { width - 1 } else { width };
    let adj_height = if height % 2 != 0 { height - 1 } else { height };

    let mut y_plane = vec![0u8; adj_width * adj_height];
    let mut u_plane = vec![0u8; (adj_width / 2) * (adj_height / 2)];
    let mut v_plane = vec![0u8; (adj_width / 2) * (adj_height / 2)];

    let rgba = image.as_raw();
    for j in 0..adj_height {
        for i in 0..adj_width {
            let idx = (j * width + i) * 4;
            let y = rgba[idx];
            y_plane[j * adj_width + i] = y;
            if j % 2 == 0 && i % 2 == 0 {
                u_plane[(j / 2) * (adj_width / 2) + (i / 2)] = 128;
                v_plane[(j / 2) * (adj_width / 2) + (i / 2)] = 128;
            }
        }
    }

    struct DummyYuv {
        y: Vec<u8>,
        u: Vec<u8>,
        v: Vec<u8>,
        width: usize,
        height: usize,
    }
    impl openh264::formats::YUVSource for DummyYuv {
        fn dimensions(&self) -> (usize, usize) { (self.width, self.height) }
        fn strides(&self) -> (usize, usize, usize) { (self.width, self.width / 2, self.width / 2) }
        fn y(&self) -> &[u8] { &self.y }
        fn u(&self) -> &[u8] { &self.u }
        fn v(&self) -> &[u8] { &self.v }
    }

    let yuv = DummyYuv { y: y_plane, u: u_plane, v: v_plane, width: adj_width, height: adj_height };
    match encoder.encode(&yuv) {
        Ok(encoded) => println!("Encoded successfully, length: {}", encoded.to_vec().len()),
        Err(e) => println!("Encode failed: {:?}", e),
    }
}
