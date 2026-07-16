// 3단계 게이트 — 실계정 accounts-cycle 1회 실행 (컨트롤러 전용 실행).
// 사용법: cargo run --example cyclegate -- <data-dir-복사본>
// examples/에 두는 이유: src/bin/의 cargo bin 타깃은 tauri 번들러가 인스톨러에 동봉한다(P5 게이트에서 적발).
// <data-dir>은 %APPDATA%\UsageMeter의 *복사본*이어야 한다 — 실 DB/금고에 쓰지 않기 위함.
// (자격증명 원본 ~/.claude/.credentials.json, ~/.codex/auth.json은 v1 앱과 동일한 방식으로 읽는다.
//  클로드 토큰이 만료 임박이면 v1과 동일한 구조 보존 원자 쓰기로 갱신될 수 있다 — 프로덕션 동작 그대로.)
// 보안: 토큰·계정 id 전문을 출력하지 않는다. 이메일/플래그/창 수치만(앱 UI 표시 항목).
use std::path::{Path, PathBuf};
use usagemeter_lib::accounts_cycle::{
    run_accounts_cycle, ActiveResults, ClaudeCycleDeps, CodexActive, CodexCycleDeps, CycleDeps,
};
use usagemeter_lib::providers::claude::account::{default_claude_config_path, read_claude_account};
use usagemeter_lib::providers::claude::credentials::default_cred_path;
use usagemeter_lib::providers::claude::limits::fetch_claude_limits;
use usagemeter_lib::providers::claude::refresh::TokenRefresher;
use usagemeter_lib::providers::codex::auth::{default_codex_auth_path, read_codex_auth, CodexAuth};
use usagemeter_lib::providers::codex::usage_api::fetch_codex_usage;
use usagemeter_lib::providers::http::ReqwestTransport;
use usagemeter_lib::providers::types::RateStatus;
use usagemeter_lib::vault::Vault;

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn brief(label: &str, s: &RateStatus) {
    let windows: Vec<String> =
        s.windows.iter().map(|w| format!("{} {:.1}%", w.kind, w.used_percent)).collect();
    println!(
        "{label}: error={:?} stale={:?} plan={:?} windows=[{}]",
        s.error,
        s.stale,
        s.plan,
        windows.join(" / ")
    );
}

fn main() {
    let data_dir = PathBuf::from(
        std::env::args().nth(1).expect("사용법: cyclegate <data-dir-복사본>"),
    );
    assert!(
        data_dir.join("usage.db").exists(),
        "usage.db 없음 — %APPDATA%\\UsageMeter 복사본 경로를 넘겼는지 확인"
    );

    let mut conn =
        usagemeter_lib::store::db::open_db(&data_dir.join("usage.db")).expect("DB 열기 실패");
    if !usagemeter_lib::store::db::apply_multi_account_schema(&mut conn) {
        eprintln!("경고: multi-account schema 미적용 DB");
    }
    let db = std::sync::Mutex::new(conn);
    let vault = Vault::new(data_dir.join("accounts"));
    let transport = ReqwestTransport::new();
    let refresher = TokenRefresher::new();

    // 활성 조회(폴러 tickLimits의 활성 경로를 1회 재현)
    let claude_token = refresher.ensure_fresh_token(&default_cred_path(), &transport, now_ms());
    let claude_status = fetch_claude_limits(&transport, claude_token.as_deref(), now_ms());
    brief("active claude", &claude_status);
    let codex_auth = read_codex_auth(&default_codex_auth_path());
    let codex_result = fetch_codex_usage(&transport, codex_auth.as_ref(), now_ms());
    brief("active codex", &codex_result.status);

    let read_account = || read_claude_account(&default_claude_config_path());
    let ensure_token = |p: &Path| refresher.ensure_fresh_token(p, &transport, now_ms());
    let fetch_limits = |t: Option<&str>| fetch_claude_limits(&transport, t, now_ms());
    let read_vault_auth = |p: &Path| read_codex_auth(p);
    let fetch_usage = |a: &CodexAuth| fetch_codex_usage(&transport, Some(a), now_ms());
    let deps = CycleDeps {
        db: &db,
        vault: &vault,
        now_ms: now_ms() as i64,
        claude: ClaudeCycleDeps {
            cred_path: default_cred_path(),
            read_account: &read_account,
            ensure_token: &ensure_token,
            fetch_limits: &fetch_limits,
        },
        codex: CodexCycleDeps {
            auth_path: default_codex_auth_path(),
            read_vault_auth: &read_vault_auth,
            fetch_usage: &fetch_usage,
        },
    };
    let active = ActiveResults {
        claude: Some(claude_status),
        codex: CodexActive { status: Some(codex_result.status), account: codex_result.account },
    };

    let states = run_accounts_cycle(&deps, &active);
    println!("--- cycle states: {} ---", states.len());
    for s in &states {
        let windows: Vec<String> = s
            .status
            .windows
            .iter()
            .map(|w| format!("{} {:.1}% resets={}", w.kind, w.used_percent, w.resets_at))
            .collect();
        println!(
            "{} {} live={} error={:?} lastSeen={} [{}]",
            s.account.provider,
            s.account.email,
            s.live,
            s.status.error,
            s.last_seen_at,
            windows.join(" / ")
        );
    }
}
