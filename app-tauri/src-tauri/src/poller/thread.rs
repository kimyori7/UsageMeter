// 폴러 스레드 — 설계 D1(P3)·D9: async 없이 전용 std::thread + blocking reqwest.
// limits/usage 두 스레드가 v1의 독립 setTimeout 체인 2개에 대응한다(ccusage 지연이 limits를 굶기지
// 않게). 새로고침은 mpsc 채널 신호 — recv_timeout 대기가 타이머와 깨우기를 겸한다(D10).
use crate::poller::core::{self, LimitsDeps, UsageDeps};
use crate::poller::state::AppState;
use crate::tooltip::format_tooltip;
use crate::Db;
use std::panic::AssertUnwindSafe;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 공유 앱 상태 — 폴러 스레드가 쓰고 get_state 커맨드가 읽는다.
pub struct SharedState(pub Mutex<AppState>);

/// 새로고침 신호 송신단 — refresh 커맨드/트레이 메뉴가 쏜다.
pub struct RefreshTx {
    pub limits: Sender<()>,
    pub usage: Sender<()>,
}

impl RefreshTx {
    /// fire-and-forget(D10) — 수신 스레드가 죽었어도 무시(앱 종료 중뿐).
    pub fn signal_all(&self) {
        let _ = self.limits.send(());
        let _ = self.usage.send(());
    }
}

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// 매 틱 후 호출 — v1은 변경 감지 없이 매번 push했다(트레이 툴팁 갱신 포함).
fn emit_state(app: &AppHandle) {
    let snapshot =
        app.state::<SharedState>().0.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let _ = app.emit("state", &snapshot);
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format_tooltip(&snapshot, now_ms())));
    }
}

/// 틱 중 쌓인 신호는 버리고(D17 — v1 재진입 가드 대응) 다음 신호/타임아웃까지 대기.
/// 반환 false = 채널 끊김(앱 종료) — 루프를 끝낸다.
fn drain_then_wait(rx: &Receiver<()>, delay_ms: u64) -> bool {
    while rx.try_recv().is_ok() {}
    !matches!(rx.recv_timeout(Duration::from_millis(delay_ms)), Err(RecvTimeoutError::Disconnected))
}

pub fn spawn_limits(app: AppHandle, deps: LimitsDeps, base_ms: u64, rx: Receiver<()>) {
    std::thread::spawn(move || {
        let mut failures: u32 = 0;
        loop {
            // 패닉은 계약 위반(버그)이지만 상주 앱의 폴링 루프를 죽이지 않는다 — 해당 틱만 실패 처리.
            // (Mutex는 전부 poison-safe 잠금이라 이후 틱이 계속된다.)
            failures = std::panic::catch_unwind(AssertUnwindSafe(|| {
                let db = app.state::<Db>();
                let shared = app.state::<SharedState>();
                core::tick_limits(&deps, &db.0, &shared.0, failures, now_ms())
            }))
            .unwrap_or(failures + 1);
            emit_state(&app);
            if !drain_then_wait(&rx, core::next_limits_delay(base_ms, failures)) {
                return;
            }
        }
    });
}

pub fn spawn_usage(app: AppHandle, deps: UsageDeps, base_ms: u64, rx: Receiver<()>) {
    std::thread::spawn(move || loop {
        let _ = std::panic::catch_unwind(AssertUnwindSafe(|| {
            let db = app.state::<Db>();
            let shared = app.state::<SharedState>();
            // 오늘 날짜는 SQLite localtime(D11) — queries.rs의 date(…,'localtime') 규약과 같은 소스.
            let today: String = {
                let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
                conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))
                    .unwrap_or_else(|_| "1970-01-01".into())
            };
            core::tick_usage(&deps, &db.0, &shared.0, now_ms(), &today);
        }));
        emit_state(&app);
        if !drain_then_wait(&rx, base_ms) {
            return;
        }
    });
}
