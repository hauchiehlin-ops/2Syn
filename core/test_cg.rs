fn main() {
    let w = core_graphics::display::CGDisplay::main().bounds().size.width;
    let h = core_graphics::display::CGDisplay::main().bounds().size.height;
    println!("{}x{}", w, h);
}
