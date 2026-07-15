pub mod accounts_cycle;
mod commands;
mod mock_state;
pub mod paths;
pub mod providers;
pub mod settings;
pub mod store;
mod tray;
pub mod vault;
mod windows;

use tauri::Manager;

pub struct Db(pub std::sync::Mutex<rusqlite::Connection>);

pub fn run() {
    let data_dir = paths::data_dir();
    std::fs::create_dir_all(&data_dir).expect("데이터 디렉터리 생성 실패");
    let mut conn = store::db::open_db(&data_dir.join("usage.db")).expect("usage.db 열기 실패");
    if !store::db::apply_multi_account_schema(&mut conn) {
        eprintln!("[UsageMeter] multi-account schema migration failed — feature disabled");
    }

    tauri::Builder::default()
        .manage(Db(std::sync::Mutex::new(conn)))
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
