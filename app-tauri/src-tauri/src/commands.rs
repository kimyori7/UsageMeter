// Tauri 명령 — v1 ipc.ts 대응. 1단계에서는 get_state=목, query_*=빈 배열, settings=기본값 echo.
// payload는 전부 camelCase JSON (렌더러 무수정 계약).
use serde_json::{json, Value};
use tauri::{AppHandle, Window};

use crate::{mock_state, windows};

#[tauri::command]
pub fn get_state() -> Value {
    mock_state::fixture()
}

#[tauri::command]
pub fn refresh() {
    // 1단계 no-op — 4단계에서 poller.refresh_now로 교체.
}

#[tauri::command]
pub fn open_dashboard(app: AppHandle) {
    windows::show_dashboard(&app);
}

#[tauri::command]
pub fn resize_popup(app: AppHandle, window: Window, height: f64) {
    windows::resize_popup(&app, window.label(), height);
}

#[tauri::command]
pub fn query_daily(_opts: Value) -> Value {
    json!([])
}

#[tauri::command]
pub fn query_folders(_opts: Value) -> Value {
    json!([])
}

#[tauri::command]
pub fn query_folder_sessions(_folder: String, _opts: Value) -> Value {
    json!([])
}

#[tauri::command]
pub fn query_monthly() -> Value {
    json!([])
}

#[tauri::command]
pub fn query_snapshots(_opts: Value) -> Value {
    json!([])
}

#[tauri::command]
pub fn get_settings() -> Value {
    json!({ "autoStart": false, "limitsIntervalSec": 300, "usageIntervalMin": 5 })
}

#[tauri::command]
pub fn set_settings(settings: Value) -> Value {
    // 1단계 echo — 2단계에서 clamp+저장 실구현으로 교체.
    settings
}
