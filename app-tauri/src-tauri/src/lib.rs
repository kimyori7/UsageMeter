pub mod accounts_cycle;
pub mod ccusage;
mod commands;
pub mod paths;
pub mod poller;
pub mod providers;
pub mod settings;
pub mod store;
mod tooltip;
mod tray;
pub mod vault;
mod windows;

use tauri::Manager;

pub struct Db(pub std::sync::Mutex<rusqlite::Connection>);

pub fn run() {
    let data_dir = paths::data_dir();
    std::fs::create_dir_all(&data_dir).expect("데이터 디렉터리 생성 실패");
    let mut conn = store::db::open_db(&data_dir.join("usage.db")).expect("usage.db 열기 실패");
    let multi_account = store::db::apply_multi_account_schema(&mut conn);
    if !multi_account {
        eprintln!("[UsageMeter] multi-account schema migration failed — feature disabled");
    }

    // 폴링 주기는 부팅 시 1회 읽는다(v1 동일 — 설정 화면의 "재시작 후 적용" 문구가 참이 되도록).
    let settings = settings::load_settings();
    // normalize()가 항상 양의 정수를 보장하므로 폴백은 사실상 도달 불가 — 기본값의 단일 정의는
    // core의 v1-parity 상수(5분)에 둔다.
    let limits_ms = settings["limitsIntervalSec"]
        .as_u64()
        .map(|s| s * 1000)
        .unwrap_or(poller::core::LIMITS_MS_DEFAULT);
    let usage_ms = settings["usageIntervalMin"]
        .as_u64()
        .map(|m| m * 60_000)
        .unwrap_or(poller::core::USAGE_MS_DEFAULT);

    let (limits_tx, limits_rx) = std::sync::mpsc::channel();
    let (usage_tx, usage_rx) = std::sync::mpsc::channel();
    let accounts_dir = data_dir.join("accounts");

    tauri::Builder::default()
        .manage(Db(std::sync::Mutex::new(conn)))
        .manage(poller::thread::SharedState(std::sync::Mutex::new(
            poller::state::AppState::initial(),
        )))
        .manage(poller::thread::RefreshTx { limits: limits_tx, usage: usage_tx })
        .setup(move |app| {
            app.manage(windows::TrayBounds::default());
            tray::create_tray(app.handle())?;
            // 트레이 생성 후에 폴러를 띄운다 — emit_state가 tray_by_id("main")을 찾는다.
            poller::thread::spawn_limits(
                app.handle().clone(),
                poller::wiring::build_limits_deps(multi_account, accounts_dir.clone()),
                limits_ms,
                limits_rx,
            );
            poller::thread::spawn_usage(
                app.handle().clone(),
                poller::wiring::build_usage_deps(),
                usage_ms,
                usage_rx,
            );
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
