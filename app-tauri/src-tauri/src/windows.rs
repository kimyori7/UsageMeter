// 팝업(트레이 위, frameless, blur 숨김)·대시보드(일반 창, 있으면 focus) 관리.
// 좌표는 전부 논리(logical) 단위 — 물리(physical) 좌표는 호출부에서 scale_factor로 변환해 넘긴다.

use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Theme, WebviewUrl, WebviewWindowBuilder,
};

pub const POPUP_WIDTH: f64 = 356.0;
pub const POPUP_INIT_HEIGHT: f64 = 400.0;
pub const POPUP_MIN_HEIGHT: f64 = 180.0;
pub const POPUP_MAX_HEIGHT: f64 = 560.0;
pub const DASHBOARD_WIDTH: f64 = 960.0;
pub const DASHBOARD_HEIGHT: f64 = 680.0;

/// (x, y, w, h) 논리 좌표 사각형.
pub type Rect = (f64, f64, f64, f64);

/// v1 popupPosition과 동일: 트레이 중심 위쪽, 작업영역(work area) 안으로 clamp.
pub fn popup_position(tray: Rect, work: Rect, height: f64) -> (f64, f64) {
    let raw_x = tray.0 + tray.2 / 2.0 - POPUP_WIDTH / 2.0;
    let raw_y = tray.1 - height; // 작업표시줄은 보통 하단 — 트레이 위로 띄운다
    let x = raw_x.max(work.0).min(work.0 + work.2 - POPUP_WIDTH);
    let y = raw_y.max(work.1).min(work.1 + work.3 - height);
    (x.round(), y.round())
}

/// v1 resizePopup과 동일한 높이 clamp (180~560, 올림).
pub fn clamp_popup_height(content_height: f64) -> f64 {
    content_height.ceil().max(POPUP_MIN_HEIGHT).min(POPUP_MAX_HEIGHT)
}

/// 마지막으로 알려진 트레이 아이콘 사각형(논리 좌표) — tray.rs가 클릭 이벤트마다 갱신한다.
#[derive(Default)]
pub struct TrayBounds(pub std::sync::Mutex<Option<Rect>>);

fn tray_rect(app: &AppHandle) -> Rect {
    // 아직 클릭 이벤트가 없었으면(부팅 직후 second-instance 등) 주 모니터 우하단으로 폴백.
    if let Some(r) = *app.state::<TrayBounds>().0.lock().unwrap() {
        return r;
    }
    let (wx, wy, ww, wh) = work_area(app);
    (wx + ww - 24.0, wy + wh, 24.0, 24.0)
}

fn work_area(app: &AppHandle) -> Rect {
    if let Ok(Some(m)) = app.primary_monitor() {
        let scale = m.scale_factor();
        let pos = m.work_area().position.to_logical::<f64>(scale);
        let size = m.work_area().size.to_logical::<f64>(scale);
        (pos.x, pos.y, size.width, size.height)
    } else {
        (0.0, 0.0, 1920.0, 1080.0)
    }
}

/// 트레이 좌클릭 전용 토글 — 보이면 숨기고, 없거나 숨겨져 있으면 띄운다.
pub fn toggle_popup(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
    }
    ensure_popup_shown(app);
}

/// 팝업 표시 보장 — 절대 숨기지 않는다 (트레이 메뉴 '열기', second-instance).
pub fn ensure_popup_shown(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        // content-fit으로 조정된 현재 높이 기준으로 재배치 (초기 상수로 되돌리면 위치가 어긋난다)
        let height = win
            .inner_size()
            .ok()
            .map(|s| s.to_logical::<f64>(win.scale_factor().unwrap_or(1.0)).height)
            .unwrap_or(POPUP_INIT_HEIGHT);
        let (x, y) = popup_position(tray_rect(app), work_area(app), height);
        let _ = win.set_position(LogicalPosition::new(x, y));
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let (x, y) = popup_position(tray_rect(app), work_area(app), POPUP_INIT_HEIGHT);
    let win = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("index.html?mode=popup".into()))
        .inner_size(POPUP_WIDTH, POPUP_INIT_HEIGHT)
        .position(x, y)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        // v1 ready-to-show 패리티: 콘텐츠가 그려진 뒤에야 처음 표시한다. 생성 직후 show하면
        // 빈(흰) 창이 깜빡이고, 웹뷰 초기화 중 포커스 요동이 아래 blur 숨김을 발동시켜
        // "몇 번 뜨려다 닫히는" 첫 클릭 증상이 된다.
        .on_page_load(|window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build();
    let Ok(win) = win else { return };
    let w = win.clone();
    win.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(false) => {
            let _ = w.hide(); // blur 시 자동 숨김 (v1과 동일)
        }
        _ => {}
    });
}

/// 렌더러가 보고한 콘텐츠 높이로 content-fit — 호출 창이 팝업일 때만 (v1 sender 검증과 동일).
pub fn resize_popup(app: &AppHandle, caller_label: &str, content_height: f64) {
    if caller_label != "popup" {
        return;
    }
    let Some(win) = app.get_webview_window("popup") else { return };
    let height = clamp_popup_height(content_height);
    let scale = win.scale_factor().unwrap_or(1.0);
    let current = win
        .inner_size()
        .ok()
        .map(|s| s.to_logical::<f64>(scale).height)
        .unwrap_or(0.0);
    if (current - height).abs() < 1.0 {
        return; // 변화 없으면 no-op
    }
    let (x, y) = popup_position(tray_rect(app), work_area(app), height);
    let _ = win.set_size(LogicalSize::new(POPUP_WIDTH, height));
    let _ = win.set_position(LogicalPosition::new(x, y));
}

/// 대시보드 — 이미 있으면 focus만, 없으면 생성.
pub fn show_dashboard(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("dashboard") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        "dashboard",
        WebviewUrl::App("index.html?mode=dashboard".into())
    )
    .title("UsageMeter")
    .inner_size(DASHBOARD_WIDTH, DASHBOARD_HEIGHT)
    // 앱 UI가 상시 다크라 타이틀바도 다크로 고정 — 윈도우 기본 흰 타이틀바가 본문과 충돌한다.
    .theme(Some(Theme::Dark))
    .visible(false)
    // v1 ready-to-show 패리티: 로드 완료 후 표시(빈 흰 창 깜빡임 방지).
    .on_page_load(|window, payload| {
        if matches!(payload.event(), PageLoadEvent::Finished) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    })
    .build();
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = (0.0, 0.0, 1920.0, 1040.0); // 하단 작업표시줄 40px 가정

    #[test]
    fn positions_popup_above_tray_centered() {
        // 트레이 아이콘이 (1200, 1040) 부근 24x24 — clamp가 안 걸리는 위치 (우측 여유 충분).
        // (브리프 원본 fixture x=1800은 1634+356=1990 > 1920이라 clamp에 걸려
        //  '중심 정렬' 검증 의도와 모순 — v1 clamp 의미론상 1564가 정답이어서 위치만 수정.)
        let (x, y) = popup_position((1200.0, 1040.0, 24.0, 24.0), WORK, 400.0);
        assert_eq!(x, (1200.0f64 + 12.0 - 178.0).round()); // 중심 - 폭/2 = 1034
        assert_eq!(y, 640.0); // 1040 - 400
    }

    #[test]
    fn clamps_x_to_work_area_right_edge() {
        let (x, _) = popup_position((1910.0, 1040.0, 24.0, 24.0), WORK, 400.0);
        assert_eq!(x, 1920.0 - POPUP_WIDTH); // 오른쪽 밖으로 못 나간다
    }

    #[test]
    fn clamps_y_to_top_when_tray_near_top() {
        let (_, y) = popup_position((100.0, 10.0, 24.0, 24.0), WORK, 400.0);
        assert_eq!(y, 0.0);
    }

    #[test]
    fn clamps_height_to_min_max_and_ceils() {
        assert_eq!(clamp_popup_height(0.0), POPUP_MIN_HEIGHT);
        assert_eq!(clamp_popup_height(9999.0), POPUP_MAX_HEIGHT);
        assert_eq!(clamp_popup_height(300.2), 301.0);
    }
}
