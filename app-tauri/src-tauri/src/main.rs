// 릴리스 빌드에서 콘솔 창이 뜨지 않게 한다 (Windows GUI 앱).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    usagemeter_lib::run()
}
