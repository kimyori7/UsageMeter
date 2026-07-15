// 트레이 아이콘 호버 툴팁 한 줄 요약 — v1 main/tooltip.ts 이식(순수 함수).
// 창(windows)이 있는 provider만 고정 순서(claude, codex)로 나열하고, 창이 없으면 그 provider는
// 생략한다. 표시되는 provider 중 마지막 하나만 '오늘 $합계'(두 provider 합산), 그 앞은 자신의
// session_5h 리셋까지 'HhMm'. error가 있어도 windows가 남아있으면(직전 성공값 stale 유지) 계속
// 표시한다 — 생략 여부는 error가 아니라 windows 부재로만 판단(스펙 §7).
use crate::poller::state::AppState;
use crate::providers::types::{RateStatus, RateWindow};

/// 표시용 대표 창: session_5h 우선, 없으면 첫 창 (windows 배열 순서 가정 금지 — types 계약).
fn display_window(status: &RateStatus) -> Option<&RateWindow> {
    status.windows.iter().find(|w| w.kind == "session_5h").or_else(|| status.windows.first())
}

fn format_duration(resets_at_sec: f64, now_ms: f64) -> String {
    let remaining_min = ((resets_at_sec * 1000.0 - now_ms) / 60_000.0).round().max(0.0) as i64;
    format!("{}h{}m", remaining_min / 60, remaining_min % 60)
}

fn format_money(usd: f64) -> String {
    format!("${usd:.2}")
}

pub fn format_tooltip(state: &AppState, now_ms: f64) -> String {
    let ordered: [(&str, Option<&RateStatus>); 2] = [
        ("Claude", state.limits.claude.as_ref()),
        ("Codex", state.limits.codex.as_ref()),
    ];
    let present: Vec<(&str, &RateStatus)> = ordered
        .into_iter()
        .filter_map(|(label, s)| s.filter(|s| !s.windows.is_empty()).map(|s| (label, s)))
        .collect();
    let total = state.today.claude.cost_usd + state.today.codex.cost_usd;

    if present.is_empty() {
        return format!("오늘 {}", format_money(total));
    }
    let segments: Vec<String> = present
        .iter()
        .enumerate()
        .map(|(i, (label, status))| {
            let win = display_window(status).expect("present는 windows 비어있지 않음");
            let pct = win.used_percent.round() as i64;
            let tail = if i == present.len() - 1 {
                format!("오늘 {}", format_money(total))
            } else {
                format_duration(win.resets_at, now_ms)
            };
            format!("{label} {pct}% · {tail}")
        })
        .collect();
    segments.join(" | ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::poller::state::{AppState, TodayEntry};
    use crate::providers::types::{RateError, RateStatus, RateWindow};

    fn win(kind: &str, pct: f64, resets_at: f64) -> RateWindow {
        RateWindow { kind: kind.into(), used_percent: pct, resets_at }
    }

    fn status(provider: &str, windows: Vec<RateWindow>) -> RateStatus {
        RateStatus { windows, ..RateStatus::base(provider, 0.0) }
    }

    fn state_with(claude: Option<RateStatus>, codex: Option<RateStatus>) -> AppState {
        let mut st = AppState::initial();
        st.limits.claude = claude;
        st.limits.codex = codex;
        st.today.claude = TodayEntry { cost_usd: 8.42, total_tokens: 0 };
        st.today.codex = TodayEntry { cost_usd: 2.17, total_tokens: 0 };
        st
    }

    #[test]
    fn both_providers_last_gets_today_total() {
        // now=0, resets 2h 뒤 — v1과 byte 단위 동일 포맷(· = U+00B7)
        let st = state_with(
            Some(status("claude", vec![win("session_5h", 62.4, 7200.0)])),
            Some(status("codex", vec![win("session_5h", 45.0, 5400.0)])),
        );
        assert_eq!(format_tooltip(&st, 0.0), "Claude 62% · 2h0m | Codex 45% · 오늘 $10.59");
    }

    #[test]
    fn single_provider_gets_total_directly() {
        let st = state_with(Some(status("claude", vec![win("session_5h", 10.0, 3600.0)])), None);
        assert_eq!(format_tooltip(&st, 0.0), "Claude 10% · 오늘 $10.59");
    }

    #[test]
    fn no_windows_anywhere_shows_total_only() {
        let st = state_with(Some(status("claude", vec![])), None);
        assert_eq!(format_tooltip(&st, 0.0), "오늘 $10.59");
    }

    #[test]
    fn stale_error_with_windows_still_shown() {
        // 생략 판단은 windows 부재로만 — error/stale이어도 표시 (스펙 §7)
        let mut s = status("codex", vec![win("session_5h", 88.0, 900.0)]);
        s.stale = Some(true);
        s.error = Some(RateError::Network);
        let st = state_with(None, Some(s));
        assert_eq!(format_tooltip(&st, 0.0), "Codex 88% · 오늘 $10.59");
    }

    #[test]
    fn session_5h_preferred_else_first_window() {
        let st = state_with(
            Some(status("claude", vec![win("weekly", 30.0, 86400.0), win("session_5h", 55.0, 7200.0)])),
            Some(status("codex", vec![win("weekly", 12.0, 86400.0)])), // session_5h 없음 → 첫 창
        );
        // claude(55%)는 session_5h 선택, codex는 weekly 폴백(12%)
        assert_eq!(format_tooltip(&st, 0.0), "Claude 55% · 2h0m | Codex 12% · 오늘 $10.59");
    }

    #[test]
    fn duration_clamps_negative_and_formats_hours_minutes() {
        assert_eq!(format_duration(-100.0, 0.0), "0h0m"); // 이미 지난 리셋 → 0 고정
        assert_eq!(format_duration(9000.0, 0.0), "2h30m");
    }
}
