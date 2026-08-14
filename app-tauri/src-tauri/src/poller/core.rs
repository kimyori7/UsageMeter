// 폴링 틱 로직 — v1 main/poller.ts 이식. 스레드/타이머/tauri와 분리된 순수 조립 계층으로,
// 시각(now_ms)·오늘 날짜(today)·외부 효과(네트워크/ccusage/사이클)는 전부 주입받는다(D12).
// 계약(v1 동일): fetch/read 계열은 panic하지 않고 실패를 status.error로 알린다(P3 전 함수 무-panic).
// limits 실패 시 직전 성공값을 stale=true로 유지하고 재시도 간격을 1분으로 좁힌다(성공 시 base 복귀).
// usage 실패는 last-good 상태(DB에 남은 값)를 유지하고 고정 주기로 조용히 재시도한다(백오프 없음).
use crate::accounts_cycle::{AccountRateState, ActiveResults, CodexActive};
use crate::poller::state::{AppState, Today};
use crate::providers::codex::usage_api::CodexUsageResult;
use crate::providers::normalizer::{normalize_daily, normalize_sessions};
use crate::providers::types::RateStatus;
use crate::store::daily::{upsert_daily, DailyRow};
use crate::store::queries::today_by_provider;
use crate::store::sessions::{upsert_sessions, SessionRow};
use crate::store::snapshots::record_snapshots;
use rusqlite::Connection;
use serde_json::Value;
use std::sync::{Mutex, MutexGuard};

pub const LIMITS_MS_DEFAULT: u64 = 5 * 60_000;
pub const USAGE_MS_DEFAULT: u64 = 5 * 60_000;
pub const LIMITS_RETRY_MS: u64 = 60_000;

/// limits 틱 전용: 실패 중엔 짧게(1분) 재시도한다. base가 그보다 짧으면 base 유지(과폭주 방지).
pub fn next_limits_delay(base_ms: u64, failures: u32) -> u64 {
    if failures == 0 {
        base_ms
    } else {
        LIMITS_RETRY_MS.min(base_ms)
    }
}

pub struct LimitsDeps {
    pub fetch_claude_limits: Box<dyn Fn(f64) -> RateStatus + Send>,
    pub fetch_codex_usage: Box<dyn Fn(f64) -> CodexUsageResult + Send>,
    pub read_codex_limits: Box<dyn Fn(f64) -> RateStatus + Send>,
    /// None = 레거시 모드(멀티계정 마이그레이션 실패) — 틱이 '' 태그로 직접 스냅샷을 기록한다.
    pub accounts_cycle:
        Option<Box<dyn Fn(&Mutex<Connection>, &ActiveResults, f64) -> Vec<AccountRateState> + Send>>,
}

pub struct UsageDeps {
    pub run_ccusage: Box<dyn Fn(&[&str]) -> Result<Value, ()> + Send>,
    pub codex_cwd_of: Option<Box<dyn Fn(&str, &str) -> Option<String> + Send>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 직전 성공값이 있으면 그 값을 stale=true로 유지, 없으면 새로 온 에러 상태 그대로 (v1 staleFallback).
fn stale_fallback(prev: Option<&RateStatus>, fresh_error: RateStatus) -> RateStatus {
    match prev {
        Some(p) => RateStatus { stale: Some(true), error: fresh_error.error, ..p.clone() },
        None => fresh_error,
    }
}

pub fn tick_limits(
    deps: &LimitsDeps,
    db: &Mutex<Connection>,
    state: &Mutex<AppState>,
    failures: u32,
    now_ms: f64,
) -> u32 {
    // 네트워크는 어떤 잠금도 잡지 않은 상태에서 — 커맨드 스레드의 쿼리/get_state를 막지 않는다.
    let claude_fresh = (deps.fetch_claude_limits)(now_ms);
    let wham = (deps.fetch_codex_usage)(now_ms);
    let codex_account = wham.account;
    let mut codex_fresh = wham.status;
    if codex_fresh.error.is_some() {
        let rollout = (deps.read_codex_limits)(now_ms);
        if rollout.error.is_none() {
            codex_fresh = rollout; // wham 실패 시 rollout 폴백(스펙 §데이터 흐름 2)
        }
    }

    let mut failed = false;
    let (applied_claude, applied_codex) = {
        // apply 클로저는 이 블록 안에서만 산다 — failed의 가변 차용이 블록 밖 읽기와 겹치지 않게.
        let mut apply = |prev: Option<&RateStatus>, fresh: RateStatus| -> RateStatus {
            if fresh.error.is_some() {
                failed = true;
                stale_fallback(prev, fresh)
            } else {
                fresh
            }
        };
        let mut st = lock(state);
        let claude = apply(st.limits.claude.as_ref(), claude_fresh);
        let codex = apply(st.limits.codex.as_ref(), codex_fresh);
        st.limits.claude = Some(claude.clone());
        st.limits.codex = Some(codex.clone());
        (claude, codex)
    };

    if deps.accounts_cycle.is_none() {
        // 레거시 모드에서만 직접 기록 — 사이클 모드에선 사이클이 계정 태그로 기록한다(이중 기록 금지).
        // 기록(DB) 실패는 fetch 성공 판정과 무관 — 상태는 정상 유지, 다음 틱에 재시도 (v1 동일).
        for status in [&applied_claude, &applied_codex] {
            if status.error.is_none() {
                let mut conn = lock(db);
                let _ = record_snapshots(
                    &mut conn,
                    &status.provider,
                    status.fetched_at as i64,
                    &status.windows,
                    "",
                );
            }
        }
    }

    if let Some(cycle) = &deps.accounts_cycle {
        // v1과 동일: 사이클에는 적용 후(스테일 폴백 반영) 상태를 넘긴다 — this.state.limits.* 대응.
        let active = ActiveResults {
            claude: Some(applied_claude),
            codex: CodexActive { status: Some(applied_codex), account: codex_account },
        };
        let accounts = cycle(db, &active, now_ms);
        lock(state).accounts = accounts;
    }

    if failed {
        failures + 1
    } else {
        0
    }
}

/// 한 provider의 daily+session을 수집·정규화한다. CLI 실패 시 None — 다른 provider와 격리(v1 collectUsage).
fn collect_usage(deps: &UsageDeps, provider: &str) -> Option<(Vec<DailyRow>, Vec<SessionRow>)> {
    let daily_json = (deps.run_ccusage)(&[provider, "daily", "--json"]).ok()?;
    let sessions_json = (deps.run_ccusage)(&[provider, "session", "--json"]).ok()?;
    let cwd_of = if provider == "codex" {
        deps.codex_cwd_of.as_ref().map(|f| &**f as &dyn Fn(&str, &str) -> Option<String>)
    } else {
        None
    };
    Some((normalize_daily(provider, &daily_json), normalize_sessions(provider, &sessions_json, cwd_of)))
}

pub fn tick_usage(
    deps: &UsageDeps,
    db: &Mutex<Connection>,
    state: &Mutex<AppState>,
    now_ms: f64,
    today: &str,
) {
    // v1은 4회 실행을 병렬로 했지만 여기선 직렬(D16) — 실측 수 초, 5분 주기 대비 무시 가능.
    let collected: Vec<(Vec<DailyRow>, Vec<SessionRow>)> =
        ["claude", "codex"].iter().filter_map(|p| collect_usage(deps, p)).collect();
    if collected.is_empty() {
        return; // 전부 실패 — last-good 유지, 고정 주기 재시도
    }
    let mut daily: Vec<DailyRow> = Vec::new();
    let mut sessions: Vec<SessionRow> = Vec::new();
    for (d, s) in collected {
        daily.extend(d);
        sessions.extend(s);
    }
    // DB upsert/재조회 실패도 last-good 유지 (v1 tickUsage catch) — 조용히 반환, 다음 주기 재시도.
    let today_value = {
        let mut conn = lock(db);
        if upsert_daily(&mut conn, &daily).is_err() {
            return;
        }
        if upsert_sessions(&mut conn, &sessions).is_err() {
            return;
        }
        match today_by_provider(&conn, today) {
            Ok(v) => v,
            Err(_) => return,
        }
    };
    let Ok(today_parsed) = serde_json::from_value::<Today>(today_value) else { return };
    let mut st = lock(state);
    st.today = today_parsed;
    st.last_usage_sync_at = Some(now_ms);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::types::{RateError, RateWindow};
    use serde_json::json;
    use std::sync::Arc;

    fn test_db() -> (tempfile::TempDir, Mutex<Connection>) {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        assert!(crate::store::db::apply_multi_account_schema(&mut conn));
        (dir, Mutex::new(conn))
    }

    fn ok_status(provider: &str, pct: f64) -> RateStatus {
        RateStatus {
            windows: vec![RateWindow { kind: "session_5h".into(), used_percent: pct, resets_at: 999.0 }],
            ..RateStatus::base(provider, 1000.0)
        }
    }

    fn err_status(provider: &str, e: RateError) -> RateStatus {
        RateStatus::with_error(provider, 2000.0, e)
    }

    fn wham_ok(pct: f64) -> CodexUsageResult {
        CodexUsageResult { account: None, status: ok_status("codex", pct) }
    }

    fn wham_err(e: RateError) -> CodexUsageResult {
        CodexUsageResult { account: None, status: err_status("codex", e) }
    }

    /// 페이크 LimitsDeps — 각 호출마다 준비된 결과를 앞에서부터 꺼내 쓴다(모자라면 마지막 반복).
    fn limits_deps(
        claude: Vec<RateStatus>,
        codex: Vec<CodexUsageResult>,
        rollout: Vec<RateStatus>,
        cycle: Option<Box<dyn Fn(&Mutex<Connection>, &ActiveResults, f64) -> Vec<AccountRateState> + Send>>,
    ) -> LimitsDeps {
        fn seq<T: Clone + Send + 'static>(items: Vec<T>) -> Box<dyn Fn() -> T + Send> {
            let state = Mutex::new((items, 0usize));
            Box::new(move || {
                let mut g = state.lock().unwrap();
                let idx = g.1.min(g.0.len() - 1);
                g.1 += 1;
                g.0[idx].clone()
            })
        }
        // CodexUsageResult는 Clone 미파생 — 필드 재조립로 복제
        let codex_seq = {
            let state = Mutex::new((codex, 0usize));
            move |_now: f64| {
                let mut g = state.lock().unwrap();
                let idx = g.1.min(g.0.len() - 1);
                g.1 += 1;
                let r = &g.0[idx];
                CodexUsageResult { account: r.account.clone(), status: r.status.clone() }
            }
        };
        let claude_seq = seq(claude);
        let rollout_seq = seq(rollout);
        LimitsDeps {
            fetch_claude_limits: Box::new(move |_| claude_seq()),
            fetch_codex_usage: Box::new(codex_seq),
            read_codex_limits: Box::new(move |_| rollout_seq()),
            accounts_cycle: cycle,
        }
    }

    fn no_cycle() -> Option<Box<dyn Fn(&Mutex<Connection>, &ActiveResults, f64) -> Vec<AccountRateState> + Send>> {
        Some(Box::new(|_, _, _| vec![]))
    }

    #[test]
    fn delay_is_base_on_success_and_one_minute_on_failure() {
        assert_eq!(next_limits_delay(300_000, 0), 300_000);
        assert_eq!(next_limits_delay(300_000, 1), 60_000);
        assert_eq!(next_limits_delay(300_000, 7), 60_000);
        assert_eq!(next_limits_delay(30_000, 3), 30_000); // base < 1분이면 base 유지
    }

    #[test]
    fn success_sets_limits_and_resets_failures() {
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = limits_deps(vec![ok_status("claude", 62.0)], vec![wham_ok(45.0)], vec![], no_cycle());
        let failures = tick_limits(&deps, &db, &state, 5, 1000.0);
        assert_eq!(failures, 0);
        let st = state.lock().unwrap();
        assert_eq!(st.limits.claude.as_ref().unwrap().windows[0].used_percent, 62.0);
        assert_eq!(st.limits.codex.as_ref().unwrap().windows[0].used_percent, 45.0);
        assert!(st.limits.claude.as_ref().unwrap().error.is_none());
    }

    #[test]
    fn failure_keeps_previous_windows_as_stale() {
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        // 1틱: 성공 / 2틱: claude만 network 실패
        let deps = limits_deps(
            vec![ok_status("claude", 62.0), err_status("claude", RateError::Network)],
            vec![wham_ok(45.0), wham_ok(46.0)],
            vec![err_status("codex", RateError::NoData)],
            no_cycle(),
        );
        assert_eq!(tick_limits(&deps, &db, &state, 0, 1000.0), 0);
        let failures = tick_limits(&deps, &db, &state, 0, 2000.0);
        assert_eq!(failures, 1); // 한 provider라도 실패면 카운트 증가
        let st = state.lock().unwrap();
        let claude = st.limits.claude.as_ref().unwrap();
        assert_eq!(claude.windows[0].used_percent, 62.0); // 직전 성공값 유지
        assert_eq!(claude.stale, Some(true));
        assert_eq!(claude.error, Some(RateError::Network)); // 신규 에러 종류로 갱신
        assert_eq!(claude.fetched_at, 1000.0); // fetchedAt은 직전 성공 시각 그대로 (v1 spread 유지)
    }

    #[test]
    fn first_failure_without_previous_keeps_error_status() {
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = limits_deps(
            vec![err_status("claude", RateError::NoCredentials)],
            vec![wham_err(RateError::Network)],
            vec![err_status("codex", RateError::NoData)],
            no_cycle(),
        );
        let failures = tick_limits(&deps, &db, &state, 0, 1000.0);
        assert_eq!(failures, 1);
        let st = state.lock().unwrap();
        assert_eq!(st.limits.claude.as_ref().unwrap().error, Some(RateError::NoCredentials));
        assert!(st.limits.claude.as_ref().unwrap().windows.is_empty());
    }

    #[test]
    fn wham_failure_falls_back_to_rollout() {
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = limits_deps(
            vec![ok_status("claude", 1.0)],
            vec![wham_err(RateError::Unauthorized)],
            vec![ok_status("codex", 33.0)], // rollout 성공 → 이 값이 채택돼야 한다
            no_cycle(),
        );
        let failures = tick_limits(&deps, &db, &state, 0, 1000.0);
        assert_eq!(failures, 0); // rollout 폴백 성공은 실패가 아니다
        let st = state.lock().unwrap();
        assert_eq!(st.limits.codex.as_ref().unwrap().windows[0].used_percent, 33.0);
        assert!(st.limits.codex.as_ref().unwrap().error.is_none());
    }

    #[test]
    fn wham_and_rollout_both_failing_keeps_wham_error() {
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = limits_deps(
            vec![ok_status("claude", 1.0)],
            vec![wham_err(RateError::Unauthorized)],
            vec![err_status("codex", RateError::NoData)], // rollout도 실패 → wham 에러 유지
            no_cycle(),
        );
        tick_limits(&deps, &db, &state, 0, 1000.0);
        let st = state.lock().unwrap();
        assert_eq!(st.limits.codex.as_ref().unwrap().error, Some(RateError::Unauthorized));
    }

    #[test]
    fn codex_account_identity_survives_rollout_fallback() {
        // 회귀 가드: wham 상태가 rollout으로 대체돼도 계정 신원은 wham 것이 사이클에 전달돼야 한다
        // (신원 캡처가 폴백 분기 뒤로 밀리면 이 테스트가 잡는다)
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let seen: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let seen2 = seen.clone();
        let cycle: Box<dyn Fn(&Mutex<Connection>, &ActiveResults, f64) -> Vec<AccountRateState> + Send> =
            Box::new(move |_, active, _| {
                *seen2.lock().unwrap() = active.codex.account.as_ref().map(|a| a.email.clone());
                vec![]
            });
        let deps = LimitsDeps {
            fetch_claude_limits: Box::new(|_| ok_status("claude", 1.0)),
            fetch_codex_usage: Box::new(|_| CodexUsageResult {
                account: Some(crate::providers::codex::usage_api::CodexAccountIdentity {
                    id: "acc-9".into(),
                    email: "fake-codex@example.com".into(),
                    plan: None,
                }),
                status: err_status("codex", RateError::Network), // 상태는 버려지지만
            }),
            read_codex_limits: Box::new(|_| ok_status("codex", 33.0)), // rollout이 채택돼도
            accounts_cycle: Some(cycle),
        };
        tick_limits(&deps, &db, &state, 0, 1000.0);
        assert_eq!(seen.lock().unwrap().as_deref(), Some("fake-codex@example.com"));
    }

    #[test]
    fn legacy_record_db_failure_does_not_break_tick() {
        // 회귀 가드: 스냅샷 기록(DB) 실패는 fetch 성공 판정·상태 갱신과 무관해야 한다 (v1 catch)
        let (_d, db) = test_db();
        db.lock().unwrap().execute("DROP TABLE rate_snapshots", []).unwrap();
        let state = Mutex::new(AppState::initial());
        let deps = limits_deps(vec![ok_status("claude", 62.0)], vec![wham_ok(45.0)], vec![], None);
        let failures = tick_limits(&deps, &db, &state, 0, 1000.0);
        assert_eq!(failures, 0);
        let st = state.lock().unwrap();
        assert_eq!(st.limits.claude.as_ref().unwrap().windows[0].used_percent, 62.0);
    }

    #[test]
    fn legacy_mode_records_snapshots_directly() {
        // accounts_cycle 미제공(마이그레이션 실패 대응) — 성공 상태를 '' 태그로 직접 기록
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = limits_deps(vec![ok_status("claude", 62.0)], vec![wham_ok(45.0)], vec![], None);
        tick_limits(&deps, &db, &state, 0, 1000.0);
        let conn = db.lock().unwrap();
        let n: i64 =
            conn.query_row("SELECT COUNT(*) FROM rate_snapshots", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2); // claude 1창 + codex 1창
    }

    #[test]
    fn cycle_mode_does_not_double_record() {
        // 사이클 모드에선 틱이 직접 기록하지 않는다(사이클이 계정 태그로 기록 — 여기선 no-op 페이크)
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = limits_deps(vec![ok_status("claude", 62.0)], vec![wham_ok(45.0)], vec![], no_cycle());
        tick_limits(&deps, &db, &state, 0, 1000.0);
        let conn = db.lock().unwrap();
        let n: i64 =
            conn.query_row("SELECT COUNT(*) FROM rate_snapshots", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn cycle_receives_post_apply_status_and_result_becomes_accounts() {
        // v1: 사이클에는 스테일 폴백이 반영된 상태가 넘어간다 + 반환이 state.accounts가 된다
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let seen: Arc<Mutex<Vec<(Option<RateError>, Option<bool>)>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let cycle: Box<dyn Fn(&Mutex<Connection>, &ActiveResults, f64) -> Vec<AccountRateState> + Send> =
            Box::new(move |_, active, _| {
                let c = active.claude.as_ref().unwrap();
                seen2.lock().unwrap().push((c.error, c.stale));
                vec![AccountRateState {
                    account: crate::accounts_cycle::AccountInfo {
                        provider: "claude".into(),
                        id: "acc-1".into(),
                        email: "fake@example.com".into(),
                        plan: None,
                    },
                    status: RateStatus::base("claude", 1000.0),
                    active: true,
                    live: true,
                    last_seen_at: 1000.0,
                }]
            });
        let deps = limits_deps(
            vec![ok_status("claude", 62.0), err_status("claude", RateError::Network)],
            vec![wham_ok(45.0), wham_ok(45.0)],
            vec![],
            Some(cycle),
        );
        tick_limits(&deps, &db, &state, 0, 1000.0);
        tick_limits(&deps, &db, &state, 0, 2000.0);
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0], (None, None)); // 1틱: 성공 상태 그대로
        assert_eq!(seen[1], (Some(RateError::Network), Some(true))); // 2틱: 폴백 반영본
        assert_eq!(state.lock().unwrap().accounts.len(), 1);
        assert_eq!(state.lock().unwrap().accounts[0].account.email, "fake@example.com");
    }

    // ---- tick_usage ----

    fn fake_ccusage(claude_ok: bool, codex_ok: bool) -> Box<dyn Fn(&[&str]) -> Result<Value, ()> + Send> {
        Box::new(move |args| {
            let ok = if args[0] == "claude" { claude_ok } else { codex_ok };
            if !ok {
                return Err(());
            }
            Ok(match (args[0], args[1]) {
                ("claude", "daily") => json!({ "daily": [{
                    "date": "2026-07-15",
                    "modelBreakdowns": [{ "modelName": "opus", "cost": 8.0, "inputTokens": 100,
                                          "outputTokens": 200, "cacheCreationTokens": 0, "cacheReadTokens": 0 }]
                }]}),
                ("claude", "session") => json!({ "sessions": [{
                    "sessionId": "cl-1", "projectPath": "D:\\proj", "totalCost": 8.0,
                    "totalTokens": 300, "lastActivity": "2026-07-15T01:00:00Z"
                }]}),
                ("codex", "daily") => json!({ "daily": [{
                    "date": "2026-07-15", "costUSD": 2.0, "inputTokens": 50, "outputTokens": 50,
                    "models": { "gpt-5": {} }
                }]}),
                _ => json!({ "sessions": [{
                    "sessionId": "cx-1", "directory": "2026/07/15", "sessionFile": "rollout-z",
                    "costUSD": 2.0, "totalTokens": 100
                }]}),
            })
        })
    }

    #[test]
    fn usage_happy_path_upserts_and_updates_today() {
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = UsageDeps {
            run_ccusage: fake_ccusage(true, true),
            codex_cwd_of: Some(Box::new(|_, _| Some("D:\\resolved".into()))),
        };
        tick_usage(&deps, &db, &state, 7000.0, "2026-07-15");
        let st = state.lock().unwrap();
        assert_eq!(st.today.claude.cost_usd, 8.0);
        assert_eq!(st.today.claude.total_tokens, 300);
        assert_eq!(st.today.codex.cost_usd, 2.0);
        assert_eq!(st.last_usage_sync_at, Some(7000.0));
        drop(st);
        let conn = db.lock().unwrap();
        let folder: String = conn
            .query_row("SELECT folder FROM session_usage WHERE session_id='cx-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(folder, "D:\\resolved"); // cwd 리졸버가 codex 세션에 배선됨
    }

    #[test]
    fn usage_provider_failure_is_isolated() {
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = UsageDeps { run_ccusage: fake_ccusage(false, true), codex_cwd_of: None };
        tick_usage(&deps, &db, &state, 7000.0, "2026-07-15");
        let st = state.lock().unwrap();
        assert_eq!(st.today.claude.cost_usd, 0.0); // claude CLI 실패 — 행 없음
        assert_eq!(st.today.codex.cost_usd, 2.0); // codex는 정상 반영
        assert_eq!(st.last_usage_sync_at, Some(7000.0)); // 부분 성공도 동기화로 친다(v1 ok.length>0)
    }

    #[test]
    fn usage_total_failure_keeps_last_good() {
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = UsageDeps { run_ccusage: fake_ccusage(false, false), codex_cwd_of: None };
        tick_usage(&deps, &db, &state, 7000.0, "2026-07-15");
        let st = state.lock().unwrap();
        assert_eq!(st.last_usage_sync_at, None); // 상태 무변경
        drop(st);
        let conn = db.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM daily_usage", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn usage_today_filters_by_date_param() {
        // today 파라미터가 다른 날짜면 오늘 합계는 0 (D11 주입 확인)
        let (_d, db) = test_db();
        let state = Mutex::new(AppState::initial());
        let deps = UsageDeps { run_ccusage: fake_ccusage(true, true), codex_cwd_of: None };
        tick_usage(&deps, &db, &state, 7000.0, "2026-07-16");
        let st = state.lock().unwrap();
        assert_eq!(st.today.claude.cost_usd, 0.0);
        assert_eq!(st.last_usage_sync_at, Some(7000.0)); // 동기화 자체는 성공
    }
}
