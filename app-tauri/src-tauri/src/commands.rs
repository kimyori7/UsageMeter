// Tauri 명령 — v1 ipc.ts 대응. get_state=목(1단계 유지), query_*/settings=실 DB·파일 위임(2단계).
// payload는 전부 camelCase JSON (렌더러 무수정 계약).
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State, Window};

use crate::poller::state::AppState;
use crate::poller::thread::{RefreshTx, SharedState};
use crate::settings;
use crate::store::queries::{self, RangeOpts};
use crate::{windows, Db};

#[tauri::command]
pub fn get_state(state: State<'_, SharedState>) -> AppState {
    // 첫 틱 전엔 initial()(v1 초기 상태와 동일) — 렌더러 useAppState는 push가 오면 덮어쓴다.
    state.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub fn refresh(tx: State<'_, RefreshTx>) {
    // fire-and-forget(D10): 두 폴링 스레드를 깨우고 즉시 반환 — 결과는 state 이벤트로 도착.
    tx.signal_all();
}

#[tauri::command]
pub fn open_dashboard(app: AppHandle) {
    windows::show_dashboard(&app);
}

#[tauri::command]
pub fn resize_popup(app: AppHandle, window: Window, height: f64) {
    windows::resize_popup(&app, window.label(), height);
}

fn lock_db<'a>(
    db: &'a State<'_, Db>,
) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    db.0.lock().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_daily(db: State<'_, Db>, opts: Option<RangeOpts>) -> Result<Vec<Value>, String> {
    let conn = lock_db(&db)?;
    queries::daily_totals(&conn, &opts.unwrap_or_default()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_folders(db: State<'_, Db>, opts: Option<RangeOpts>) -> Result<Vec<Value>, String> {
    let conn = lock_db(&db)?;
    queries::folder_rollup(&conn, &opts.unwrap_or_default()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_folder_sessions(
    db: State<'_, Db>,
    folder: String,
    opts: Option<RangeOpts>,
) -> Result<Vec<Value>, String> {
    let conn = lock_db(&db)?;
    queries::sessions_in_folder(&conn, &folder, &opts.unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn query_monthly(db: State<'_, Db>) -> Result<Vec<Value>, String> {
    let conn = lock_db(&db)?;
    queries::monthly_rollup(&conn).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotOpts {
    pub provider: String,
    pub window: String,
    pub from: i64,
}

#[tauri::command]
pub fn query_snapshots(db: State<'_, Db>, opts: SnapshotOpts) -> Result<Vec<Value>, String> {
    let conn = lock_db(&db)?;
    queries::snapshot_series(&conn, &opts.provider, &opts.window, opts.from)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings() -> Value {
    settings::load_settings()
}

#[tauri::command]
pub fn set_settings(settings: Value) -> Result<Value, String> {
    // 파라미터명은 렌더러 invoke 키 {settings}와 일치해야 한다. 로컬 변수 settings와
    // 모듈 경로 crate::settings는 Rust 네임스페이스가 달라(value vs type/module) 충돌하지 않는다.
    crate::settings::save_settings(&settings).map_err(|e| e.to_string())?;
    // clamp된 실제 저장값을 돌려준다 — 렌더러가 낙관적 업데이트로 오차값을 갖지 않도록 (v1 ipc.ts 동일)
    Ok(crate::settings::load_settings())
}
