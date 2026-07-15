// 실부품 조립 — v1 main/index.ts boot()의 폴러 deps 배선 대응. 조립 형태는 P3 게이트로 실증된
// src/bin/cyclegate.rs와 동일하다(활성 claude = ensure_fresh_token→fetch_claude_limits 조합).
// 토큰은 이 클로저들 내부(Rust 메모리)에만 머물고 반환값은 전부 RateStatus/AccountRateState다.
use crate::accounts_cycle::{
    run_accounts_cycle, AccountRateState, ActiveResults, ClaudeCycleDeps, CodexCycleDeps, CycleDeps,
};
use crate::ccusage;
use crate::poller::core::{LimitsDeps, UsageDeps};
use crate::providers::claude::account::{default_claude_config_path, read_claude_account};
use crate::providers::claude::credentials::default_cred_path;
use crate::providers::claude::limits::fetch_claude_limits;
use crate::providers::claude::refresh::TokenRefresher;
use crate::providers::codex::auth::{default_codex_auth_path, read_codex_auth, CodexAuth};
use crate::providers::codex::cwd::CwdResolver;
use crate::providers::codex::limits::{default_codex_sessions_dir, read_codex_limits};
use crate::providers::codex::usage_api::fetch_codex_usage;
use crate::providers::http::ReqwestTransport;
use crate::vault::Vault;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub fn build_limits_deps(multi_account: bool, accounts_dir: PathBuf) -> LimitsDeps {
    // transport/refresher는 활성 경로와 사이클이 공유한다(v1: 모듈 스코프 fetch/freshCache 공유 대응).
    let transport = Arc::new(ReqwestTransport::new());
    let refresher = Arc::new(TokenRefresher::new());

    let fetch_claude = {
        let (t, r) = (transport.clone(), refresher.clone());
        Box::new(move |now: f64| {
            // v1 fetchClaudeLimits()는 토큰 미지정 시 내부에서 ensureFreshToken() — 여기선 명시 조립.
            let token = r.ensure_fresh_token(&default_cred_path(), t.as_ref(), now);
            fetch_claude_limits(t.as_ref(), token.as_deref(), now)
        })
    };
    let fetch_codex = {
        let t = transport.clone();
        Box::new(move |now: f64| {
            let auth = read_codex_auth(&default_codex_auth_path());
            fetch_codex_usage(t.as_ref(), auth.as_ref(), now)
        })
    };
    let read_rollout =
        Box::new(move |now: f64| read_codex_limits(&default_codex_sessions_dir(), now));

    let accounts_cycle: Option<
        Box<dyn Fn(&Mutex<Connection>, &ActiveResults, f64) -> Vec<AccountRateState> + Send>,
    > = multi_account.then(|| {
        let (t, r) = (transport, refresher);
        let vault = Vault::new(accounts_dir);
        Box::new(move |db: &Mutex<Connection>, active: &ActiveResults, now: f64| {
            let read_account = || read_claude_account(&default_claude_config_path());
            let ensure_token = |p: &Path| r.ensure_fresh_token(p, t.as_ref(), now);
            let fetch_limits = |tok: Option<&str>| fetch_claude_limits(t.as_ref(), tok, now);
            let read_vault_auth = |p: &Path| read_codex_auth(p);
            let fetch_usage = |a: &CodexAuth| fetch_codex_usage(t.as_ref(), Some(a), now);
            run_accounts_cycle(
                &CycleDeps {
                    db,
                    vault: &vault,
                    now_ms: now as i64,
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
                },
                active,
            )
        }) as Box<dyn Fn(&Mutex<Connection>, &ActiveResults, f64) -> Vec<AccountRateState> + Send>
    });

    LimitsDeps {
        fetch_claude_limits: fetch_claude,
        fetch_codex_usage: fetch_codex,
        read_codex_limits: read_rollout,
        accounts_cycle,
    }
}

pub fn build_usage_deps() -> UsageDeps {
    let resolver = CwdResolver::new(default_codex_sessions_dir());
    UsageDeps {
        run_ccusage: Box::new(|args| {
            let bin = ccusage::ccusage_bin_path()?;
            ccusage::run_ccusage(&bin, args)
        }),
        codex_cwd_of: Some(Box::new(move |d, f| resolver.resolve(d, f))),
    }
}
