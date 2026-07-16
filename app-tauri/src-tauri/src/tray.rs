// 트레이 아이콘 + 우클릭 메뉴(열기/대시보드/새로고침/종료). 좌클릭은 팝업 토글 (v1 tray.ts와 동일).
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::windows::{self, TrayBounds};

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "열기").build(app)?;
    let dashboard = MenuItemBuilder::with_id("dashboard", "대시보드").build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", "새로고침").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "종료").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &dashboard, &refresh])
        .separator()
        .item(&quit)
        .build()?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("bundle icon missing").clone())
        .tooltip("UsageMeter")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => windows::ensure_popup_shown(app),
            "dashboard" => windows::show_dashboard(app),
            "refresh" => app.state::<crate::poller::thread::RefreshTx>().signal_all(),
            "quit" => {
                // v1 quit()의 tray.destroy() 대응: exit(0)은 drop을 건너뛰므로 아이콘을 먼저 지워
                // 죽은 프로세스의 유령 트레이 아이콘(호버 전까지 잔존)을 막는다.
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_visible(false);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state, rect, .. } = event {
                let app = tray.app_handle();
                // 클릭 좌표(물리)를 논리로 변환해 최신 트레이 위치를 기록한다.
                let scale = app
                    .primary_monitor()
                    .ok()
                    .flatten()
                    .map(|m| m.scale_factor())
                    .unwrap_or(1.0);
                let pos = rect.position.to_logical::<f64>(scale);
                let size = rect.size.to_logical::<f64>(scale);
                *app.state::<TrayBounds>().0.lock().unwrap() =
                    Some((pos.x, pos.y, size.width, size.height));
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    windows::toggle_popup(app);
                }
            }
        })
        .build(app)?;
    Ok(())
}
