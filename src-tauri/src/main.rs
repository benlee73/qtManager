#![cfg_attr(
    all(target_os = "windows", not(debug_assertions), not(feature = "e2e")),
    windows_subsystem = "windows"
)]

fn main() {
    qt_manager_lib::run();
}
