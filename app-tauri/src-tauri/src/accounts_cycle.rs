// 계정 오케스트레이션 — v1 main/accounts-cycle.ts 이식 (스펙 §데이터 흐름 1·3·4·5).
// 폴러(4단계)의 limits 틱이 활성 결과를 넘겨 호출한다.
// 코덱스에는 재발급 경로가 구조적으로 존재하지 않는다(CodexCycleDeps에 ensure_token 자체가 없음 — 스펙 F3).
// DB 잠금 규율: Mutex<Connection>을 개별 DB 연산 동안만 잡는다 — 네트워크 호출(fetch/ensure_token)
// 동안 잠그지 않는다(커맨드 스레드의 쿼리를 막지 않기 위함 — P2 인계 노트, 설계 D1).
use crate::providers::claude::account::ClaudeAccountIdentity;
use crate::providers::codex::auth::CodexAuth;
use crate::providers::codex::usage_api::{CodexAccountIdentity, CodexUsageResult};
use crate::providers::types::{RateError, RateStatus};
use crate::store::accounts::{list_accounts, touch_login_period, upsert_account, AccountRecord};
use crate::store::snapshots::{latest_account_snapshot, record_snapshots};
use crate::vault::Vault;
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub provider: String,
    pub id: String,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRateState {
    pub account: AccountInfo,
    pub status: RateStatus,
    pub live: bool,
    pub last_seen_at: f64,
}

pub struct CodexActive {
    pub status: Option<RateStatus>,
    pub account: Option<CodexAccountIdentity>,
}

pub struct ActiveResults {
    pub claude: Option<RateStatus>,
    pub codex: CodexActive,
}

pub struct ClaudeCycleDeps<'a> {
    pub cred_path: PathBuf,
    pub read_account: &'a dyn Fn() -> Option<ClaudeAccountIdentity>,
    pub ensure_token: &'a dyn Fn(&Path) -> Option<String>,
    pub fetch_limits: &'a dyn Fn(Option<&str>) -> RateStatus,
}

pub struct CodexCycleDeps<'a> {
    pub auth_path: PathBuf,
    pub read_vault_auth: &'a dyn Fn(&Path) -> Option<CodexAuth>,
    pub fetch_usage: &'a dyn Fn(&CodexAuth) -> CodexUsageResult,
}

pub struct CycleDeps<'a> {
    pub db: &'a Mutex<Connection>,
    pub vault: &'a Vault,
    pub now_ms: i64,
    pub claude: ClaudeCycleDeps<'a>,
    pub codex: CodexCycleDeps<'a>,
}

fn lock(db: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    db.lock().unwrap_or_else(|e| e.into_inner())
}

/// 스냅샷 기록 실패는 표시(라이브 상태)에 영향을 주지 않는다 — 다음 틱 재시도 (v1 safeRecord).
fn safe_record(db: &Mutex<Connection>, status: &RateStatus, account_id: &str) {
    let mut conn = lock(db);
    let _ = record_snapshots(
        &mut conn,
        &status.provider,
        status.fetched_at as i64,
        &status.windows,
        account_id,
    );
}

/// 비활성 계정 폴백 — 최신 스냅샷 기반 상태 (v1 snapshotState). DB 오류는 Err 전파(블록 격리 대상).
fn snapshot_state(
    db: &Mutex<Connection>,
    provider: &str,
    rec: &AccountRecord,
) -> rusqlite::Result<AccountRateState> {
    let snap = {
        let conn = lock(db);
        latest_account_snapshot(&conn, provider, &rec.id)?
    };
    let account = AccountInfo {
        provider: provider.to_string(),
        id: rec.id.clone(),
        email: rec.email.clone(),
        plan: rec.plan.clone(),
    };
    Ok(match snap {
        Some(s) => AccountRateState {
            account,
            status: RateStatus {
                windows: s.windows,
                fetched_at: s.fetched_at,
                ..RateStatus::base(provider, s.fetched_at)
            },
            live: false,
            last_seen_at: s.fetched_at,
        },
        None => AccountRateState {
            account,
            status: RateStatus::with_error(provider, rec.last_seen_at, RateError::NoData),
            live: false,
            last_seen_at: rec.last_seen_at,
        },
    })
}

struct Identity {
    id: String,
    email: String,
    plan: Option<String>,
}

/// 활성 계정 공통 처리 — 반환 = 활성 계정 id(신원 미상이면 None). DB 오류는 Err 전파.
fn register_active(
    deps: &CycleDeps,
    provider: &str,
    identity: Option<Identity>,
    status: Option<&RateStatus>,
    source_path: &Path,
    states: &mut Vec<AccountRateState>,
) -> rusqlite::Result<Option<String>> {
    let Some(identity) = identity else {
        // 신원 미상이어도 성공 수치는 '' 태그로 남겨 이력을 잇는다(하위 호환 표시가 이 행들을 쓴다).
        if let Some(s) = status {
            if s.error.is_none() {
                safe_record(deps.db, s, "");
            }
        }
        return Ok(None);
    };
    {
        let conn = lock(deps.db);
        upsert_account(
            &conn,
            provider,
            &identity.id,
            &identity.email,
            identity.plan.as_deref(),
            deps.now_ms,
        )?;
        touch_login_period(&conn, provider, &identity.id, deps.now_ms)?;
    }
    deps.vault.copy_if_changed(provider, &identity.id, source_path);
    let active_id = identity.id.clone();
    if let Some(s) = status {
        if s.error.is_none() {
            safe_record(deps.db, s, &identity.id);
        }
        states.push(AccountRateState {
            account: AccountInfo {
                provider: provider.to_string(),
                id: identity.id,
                email: identity.email,
                plan: identity.plan,
            },
            status: s.clone(),
            live: s.error.is_none(),
            last_seen_at: s.fetched_at,
        });
    }
    Ok(Some(active_id))
}

fn claude_block(
    deps: &CycleDeps,
    active: &ActiveResults,
    states: &mut Vec<AccountRateState>,
) -> rusqlite::Result<()> {
    let identity = (deps.claude.read_account)()
        .map(|a| Identity { id: a.id, email: a.email, plan: None });
    let active_id = register_active(
        deps,
        "claude",
        identity,
        active.claude.as_ref(),
        &deps.claude.cred_path,
        states,
    )?;
    let recs = {
        let conn = lock(deps.db);
        list_accounts(&conn, "claude")?
    };
    for rec in recs {
        if Some(&rec.id) == active_id.as_ref() {
            continue;
        }
        if deps.vault.is_revoked("claude", &rec.id) || !deps.vault.has_copy("claude", &rec.id) {
            states.push(snapshot_state(deps.db, "claude", &rec)?);
            continue;
        }
        // 네트워크 호출 동안 DB 잠금 없음.
        let token = (deps.claude.ensure_token)(&deps.vault.cred_path("claude", &rec.id));
        let status = (deps.claude.fetch_limits)(token.as_deref());
        push_inactive_result(deps, "claude", &rec, status, states)?;
    }
    Ok(())
}

fn codex_block(
    deps: &CycleDeps,
    active: &ActiveResults,
    states: &mut Vec<AccountRateState>,
) -> rusqlite::Result<()> {
    let identity = active.codex.account.as_ref().map(|a| Identity {
        id: a.id.clone(),
        email: a.email.clone(),
        plan: a.plan.clone(),
    });
    let active_id = register_active(
        deps,
        "codex",
        identity,
        active.codex.status.as_ref(),
        &deps.codex.auth_path,
        states,
    )?;
    let recs = {
        let conn = lock(deps.db);
        list_accounts(&conn, "codex")?
    };
    for rec in recs {
        if Some(&rec.id) == active_id.as_ref() {
            continue;
        }
        if deps.vault.is_revoked("codex", &rec.id) || !deps.vault.has_copy("codex", &rec.id) {
            states.push(snapshot_state(deps.db, "codex", &rec)?);
            continue;
        }
        let Some(auth) = (deps.codex.read_vault_auth)(&deps.vault.cred_path("codex", &rec.id))
        else {
            states.push(snapshot_state(deps.db, "codex", &rec)?);
            continue;
        };
        let result = (deps.codex.fetch_usage)(&auth);
        push_inactive_result(deps, "codex", &rec, result.status, states)?;
    }
    Ok(())
}

/// 비활성 계정의 라이브 조회 결과 공통 처리: unauthorized/no-credentials → revoke + 폴백,
/// 기타 에러(network 등) → revoke 없이 폴백, 성공 → 태그 기록 + live 상태.
fn push_inactive_result(
    deps: &CycleDeps,
    provider: &str,
    rec: &AccountRecord,
    status: RateStatus,
    states: &mut Vec<AccountRateState>,
) -> rusqlite::Result<()> {
    match status.error {
        Some(RateError::Unauthorized) | Some(RateError::NoCredentials) => {
            deps.vault.mark_revoked(provider, &rec.id);
            states.push(snapshot_state(deps.db, provider, rec)?);
        }
        Some(_) => {
            states.push(snapshot_state(deps.db, provider, rec)?); // 일시 오류 — revoked 아님
        }
        None => {
            safe_record(deps.db, &status, &rec.id);
            let last_seen_at = status.fetched_at;
            states.push(AccountRateState {
                account: AccountInfo {
                    provider: provider.to_string(),
                    id: rec.id.clone(),
                    email: rec.email.clone(),
                    plan: rec.plan.clone(),
                },
                status,
                live: true,
                last_seen_at,
            });
        }
    }
    Ok(())
}

/// 프로바이더별 격리(설계 D8): 한 블록의 DB 오류(v1의 동기 throw 대응물)가 다른 블록을 막지 않는다.
/// 블록 실패 시 그 블록에서 이미 push된 상태는 유지된다 (v1 외곽 catch 동일).
pub fn run_accounts_cycle(deps: &CycleDeps, active: &ActiveResults) -> Vec<AccountRateState> {
    let mut states = vec![];
    let _ = claude_block(deps, active, &mut states);
    let _ = codex_block(deps, active, &mut states);
    states
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::types::RateWindow;
    use std::cell::{Cell, RefCell};
    use std::fs;

    // FAKE 픽스처만, temp 디렉터리만 — 실계정 파일 접근 금지.
    struct Fx {
        db: Mutex<Connection>,
        vault: Vault,
        _dirs: (tempfile::TempDir, tempfile::TempDir),
        cred_path: PathBuf,
        auth_path: PathBuf,
    }

    fn fx() -> Fx {
        let root = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&root.path().join("u.db")).unwrap();
        assert!(crate::store::db::apply_multi_account_schema(&mut conn));
        let vault = Vault::new(root.path().join("accounts"));
        let cred_path = src.path().join("cred.json");
        fs::write(&cred_path, r#"{"claudeAiOauth":{"accessToken":"FAKE"}}"#).unwrap();
        let auth_path = src.path().join("auth.json");
        fs::write(&auth_path, r#"{"tokens":{"access_token":"FAKE","account_id":"cx-active"}}"#)
            .unwrap();
        Fx { db: Mutex::new(conn), vault, cred_path, auth_path, _dirs: (root, src) }
    }

    fn ok_status(provider: &str, used: f64) -> RateStatus {
        RateStatus {
            windows: vec![RateWindow {
                kind: "session_5h".into(),
                used_percent: used,
                resets_at: 9999.0,
            }],
            ..RateStatus::base(provider, 5000.0)
        }
    }

    fn active_both() -> ActiveResults {
        ActiveResults {
            claude: Some(ok_status("claude", 10.0)),
            codex: CodexActive {
                status: Some(ok_status("codex", 10.0)),
                account: Some(CodexAccountIdentity {
                    id: "cx-active".into(),
                    email: "cx@c.com".into(),
                    plan: Some("plus".into()),
                }),
            },
        }
    }

    // 표준 deps 골격 — 각 테스트가 클로저만 바꿔 낀다
    macro_rules! deps {
        ($f:expr, $read_account:expr, $ensure_token:expr, $fetch_limits:expr, $read_vault_auth:expr, $fetch_usage:expr) => {
            CycleDeps {
                db: &$f.db,
                vault: &$f.vault,
                now_ms: 5000,
                claude: ClaudeCycleDeps {
                    cred_path: $f.cred_path.clone(),
                    read_account: $read_account,
                    ensure_token: $ensure_token,
                    fetch_limits: $fetch_limits,
                },
                codex: CodexCycleDeps {
                    auth_path: $f.auth_path.clone(),
                    read_vault_auth: $read_vault_auth,
                    fetch_usage: $fetch_usage,
                },
            }
        };
    }

    fn cl_identity() -> Option<ClaudeAccountIdentity> {
        Some(ClaudeAccountIdentity { id: "cl-active".into(), email: "active@a.com".into() })
    }

    fn snapshot_count(f: &Fx, account_id: &str) -> i64 {
        lock(&f.db)
            .query_row(
                "SELECT COUNT(*) FROM rate_snapshots WHERE account_id = ?",
                [account_id],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn active_registers_touches_copies_records_and_reports_live() {
        let f = fx();
        let read_account = || cl_identity();
        let ensure = |_: &Path| Some("FAKE-TOKEN".to_string());
        let fetch = |_: Option<&str>| ok_status("claude", 33.0);
        let rva = |p: &Path| crate::providers::codex::auth::read_codex_auth(p);
        let fu = |a: &CodexAuth| CodexUsageResult {
            account: Some(CodexAccountIdentity { id: a.account_id.clone(), email: "old@c.com".into(), plan: None }),
            status: ok_status("codex", 44.0),
        };
        let deps = deps!(f, &read_account, &ensure, &fetch, &rva, &fu);
        let states = run_accounts_cycle(&deps, &active_both());

        let claude = states.iter().find(|s| s.account.id == "cl-active").unwrap();
        assert!(claude.live);
        assert_eq!(claude.account.email, "active@a.com");
        assert_eq!(claude.last_seen_at, 5000.0);
        assert!(f.vault.has_copy("claude", "cl-active"));
        assert!(f.vault.has_copy("codex", "cx-active"));
        assert!(snapshot_count(&f, "cl-active") > 0);
        let period: String = lock(&f.db)
            .query_row("SELECT account_id FROM login_periods WHERE provider='codex'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(period, "cx-active");
    }

    #[test]
    fn active_error_status_is_not_live_and_keeps_fetched_at_as_last_seen() {
        let f = fx();
        // poller.staleFallback이 직전 성공 status를 그대로 넘기므로 fetchedAt(4242) ≠ nowMs(5000)이어야 의미
        let error_status = RateStatus::with_error("claude", 4242.0, RateError::Network);
        let active = ActiveResults { claude: Some(error_status), ..active_both() };
        let read_account = || cl_identity();
        let ensure = |_: &Path| None;
        let fetch = |_: Option<&str>| ok_status("claude", 1.0);
        let rva = |_: &Path| None;
        let fu = |_: &CodexAuth| unreachable!();
        let deps = deps!(f, &read_account, &ensure, &fetch, &rva, &fu);
        let states = run_accounts_cycle(&deps, &active);
        let claude = states.iter().find(|s| s.account.id == "cl-active").unwrap();
        assert!(!claude.live);
        assert_eq!(claude.last_seen_at, 4242.0);
        assert_eq!(snapshot_count(&f, "cl-active"), 0); // 에러 상태는 스냅샷 기록 안 함
    }

    #[test]
    fn unknown_identity_with_success_records_empty_tag_for_continuity() {
        let f = fx();
        let read_account = || None;
        let ensure = |_: &Path| None;
        let fetch = |_: Option<&str>| ok_status("claude", 1.0);
        let rva = |_: &Path| None;
        let fu = |_: &CodexAuth| unreachable!();
        let deps = deps!(f, &read_account, &ensure, &fetch, &rva, &fu);
        let active = ActiveResults {
            claude: Some(ok_status("claude", 10.0)),
            codex: CodexActive { status: None, account: None },
        };
        let states = run_accounts_cycle(&deps, &active);
        assert_eq!(snapshot_count(&f, ""), 1); // '' 태그 스냅샷
        assert!(states.iter().all(|s| s.account.provider != "claude")); // 상태에는 안 실림
    }

    #[test]
    fn inactive_vault_live_success_records_tagged_and_uses_vault_cred_path() {
        let f = fx();
        {
            let conn = lock(&f.db);
            upsert_account(&conn, "claude", "cl-old", "old@a.com", None, 1000).unwrap();
        }
        f.vault.copy_if_changed("claude", "cl-old", &f.cred_path);
        let ensure_calls = RefCell::new(vec![]);
        let read_account = || cl_identity();
        let ensure = |p: &Path| {
            ensure_calls.borrow_mut().push(p.to_path_buf());
            Some("FAKE-TOKEN".to_string())
        };
        let fetch = |_: Option<&str>| ok_status("claude", 70.0);
        let rva = |_: &Path| None;
        let fu = |_: &CodexAuth| unreachable!();
        let deps = deps!(f, &read_account, &ensure, &fetch, &rva, &fu);
        let states = run_accounts_cycle(&deps, &active_both());
        let old = states.iter().find(|s| s.account.id == "cl-old").unwrap();
        assert!(old.live);
        assert_eq!(ensure_calls.borrow()[0], f.vault.cred_path("claude", "cl-old"));
        assert!(snapshot_count(&f, "cl-old") > 0);
    }

    #[test]
    fn unauthorized_marks_revoked_falls_back_and_skips_next_cycle() {
        let f = fx();
        {
            let mut conn = lock(&f.db);
            upsert_account(&conn, "claude", "cl-old", "old@a.com", None, 1000).unwrap();
            // 폴백에 쓰일 과거 스냅샷
            record_snapshots(
                &mut conn,
                "claude",
                4000,
                &[RateWindow { kind: "session_5h".into(), used_percent: 70.0, resets_at: 9999.0 }],
                "cl-old",
            )
            .unwrap();
        }
        f.vault.copy_if_changed("claude", "cl-old", &f.cred_path);
        let fetch_calls = Cell::new(0);
        let read_account = || cl_identity();
        let ensure = |_: &Path| Some("FAKE".to_string());
        let fetch = |_: Option<&str>| {
            fetch_calls.set(fetch_calls.get() + 1);
            RateStatus::with_error("claude", 5000.0, RateError::Unauthorized)
        };
        let rva = |_: &Path| None;
        let fu = |_: &CodexAuth| unreachable!();
        let deps = deps!(f, &read_account, &ensure, &fetch, &rva, &fu);

        let first = run_accounts_cycle(&deps, &active_both());
        let old = first.iter().find(|s| s.account.id == "cl-old").unwrap();
        assert!(!old.live);
        assert_eq!(old.status.windows[0].used_percent, 70.0); // 스냅샷 폴백
        assert!(f.vault.is_revoked("claude", "cl-old"));

        // 활성 계정 fetch는 deps에 없고(활성 status는 인자로 옴) 비활성만 fetch하므로 1회였음
        assert_eq!(fetch_calls.get(), 1);
        run_accounts_cycle(&deps, &active_both());
        assert_eq!(fetch_calls.get(), 1); // revoked 스킵 — 비활성 fetch 자체를 안 한다
    }

    #[test]
    fn network_error_no_revoke_and_no_snapshot_means_no_data() {
        let f = fx();
        {
            let conn = lock(&f.db);
            upsert_account(&conn, "codex", "cx-old", "old@c.com", None, 1000).unwrap();
        }
        f.vault.copy_if_changed("codex", "cx-old", &f.auth_path);
        let read_account = || cl_identity();
        let ensure = |_: &Path| Some("FAKE".to_string());
        let fetch = |_: Option<&str>| ok_status("claude", 1.0);
        let rva = |p: &Path| crate::providers::codex::auth::read_codex_auth(p);
        let fu = |_: &CodexAuth| CodexUsageResult {
            account: None,
            status: RateStatus::with_error("codex", 5000.0, RateError::Network),
        };
        let deps = deps!(f, &read_account, &ensure, &fetch, &rva, &fu);
        let states = run_accounts_cycle(&deps, &active_both());
        let old = states.iter().find(|s| s.account.id == "cx-old").unwrap();
        assert!(!old.live);
        assert_eq!(old.status.error, Some(RateError::NoData)); // 스냅샷도 없음 → no-data
        assert_eq!(old.last_seen_at, 1000.0); // rec.last_seen_at
        assert!(!f.vault.is_revoked("codex", "cx-old"));
    }

    #[test]
    fn no_vault_copy_skips_fetch_and_falls_back() {
        let f = fx();
        {
            let conn = lock(&f.db);
            upsert_account(&conn, "codex", "cx-novault", "nv@c.com", None, 1000).unwrap();
        }
        let fetch_calls = Cell::new(0);
        let read_account = || cl_identity();
        let ensure = |_: &Path| Some("FAKE".to_string());
        let fetch = |_: Option<&str>| ok_status("claude", 1.0);
        let rva = |_: &Path| None;
        let fu = |_: &CodexAuth| {
            fetch_calls.set(fetch_calls.get() + 1);
            CodexUsageResult { account: None, status: ok_status("codex", 1.0) }
        };
        let deps = deps!(f, &read_account, &ensure, &fetch, &rva, &fu);
        let states = run_accounts_cycle(&deps, &active_both());
        assert!(!states.iter().find(|s| s.account.id == "cx-novault").unwrap().live);
        assert_eq!(fetch_calls.get(), 0);
    }

    #[test]
    fn db_failure_does_not_panic_and_returns_gracefully() {
        // 설계 D8 적응 이식: v1은 "readAccount가 던져도 Codex 블록 계속"을 검증했지만 Rust 클로저는
        // throw할 수 없다 — 유일한 동기 실패원인 DB Result 오류로 격리 구조를 검증한다.
        // 마이그레이션 안 된 DB(accounts 테이블 없음)에서 upsert가 실패해도 panic 없이 귀환해야 한다.
        let root = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();
        let conn = crate::store::db::open_db(&root.path().join("u.db")).unwrap(); // 마이그레이션 미적용
        let f = Fx {
            db: Mutex::new(conn),
            vault: Vault::new(root.path().join("accounts")),
            cred_path: src.path().join("cred.json"),
            auth_path: src.path().join("auth.json"),
            _dirs: (root, src),
        };
        fs::write(&f.cred_path, r#"{"claudeAiOauth":{"accessToken":"FAKE"}}"#).unwrap();
        fs::write(&f.auth_path, r#"{"tokens":{"access_token":"FAKE","account_id":"cx-active"}}"#)
            .unwrap();
        let read_account = || cl_identity();
        let ensure = |_: &Path| Some("FAKE".to_string());
        let fetch = |_: Option<&str>| ok_status("claude", 1.0);
        let rva = |_: &Path| None;
        let fu = |_: &CodexAuth| CodexUsageResult { account: None, status: ok_status("codex", 1.0) };
        let deps = deps!(f, &read_account, &ensure, &fetch, &rva, &fu);
        let states = run_accounts_cycle(&deps, &active_both()); // panic 없이
        assert!(states.is_empty()); // 두 블록 모두 upsert에서 중단 — push 전이므로 빈 결과
    }
}
