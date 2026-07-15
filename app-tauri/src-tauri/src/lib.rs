mod commands;
mod mock_state;
pub mod paths;
pub mod store;
mod tray;
mod windows;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(windows::TrayBounds::default());
            tray::create_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::refresh,
            commands::open_dashboard,
            commands::resize_popup,
            commands::query_daily,
            commands::query_folders,
            commands::query_folder_sessions,
            commands::query_monthly,
            commands::query_snapshots,
            commands::get_settings,
            commands::set_settings
        ])
        .run(tauri::generate_context!())
        .expect("tauri 실행 실패");
}
