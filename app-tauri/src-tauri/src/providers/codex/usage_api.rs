// 코덱스 능동 한도 API — v1 providers/codex/usage-api.ts 이식 (스펙 §코덱스 provider 계약).
// 창 매핑: limit_window_seconds 18000→session_5h, 604800→weekly. 절대 panic하지 않는다.
use crate::providers::codex::auth::CodexAuth;
use crate::providers::http::{HttpRequest, Transport};
use crate::providers::types::{RateError, RateStatus, RateWindow};
use serde_json::Value;

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

#[derive(Debug, Clone, PartialEq)]
pub struct CodexAccountIdentity {
    pub id: String,
    pub email: String,
    pub plan: Option<String>,
}

pub struct CodexUsageResult {
    pub account: Option<CodexAccountIdentity>,
    pub status: RateStatus,
}

fn window_kind(seconds: &Value) -> Option<&'static str> {
    // v1 === 비교: JSON이 18000.0으로 와도 숫자 동등이면 매칭돼야 하므로 as_f64로 본다
    match seconds.as_f64() {
        Some(s) if s == 18000.0 => Some("session_5h"),
        Some(s) if s == 604800.0 => Some("weekly"),
        _ => None,
    }
}

fn to_window(raw: &Value) -> Option<RateWindow> {
    let used = raw["used_percent"].as_f64()?;
    let kind = window_kind(&raw["limit_window_seconds"])?;
    Some(RateWindow {
        kind: kind.to_string(),
        used_percent: used,
        resets_at: raw["reset_at"].as_f64().unwrap_or(0.0),
    })
}

fn fail(base: RateStatus, error: RateError) -> CodexUsageResult {
    CodexUsageResult { account: None, status: RateStatus { error: Some(error), ..base } }
}

pub fn fetch_codex_usage(
    transport: &dyn Transport,
    auth: Option<&CodexAuth>,
    fetched_at_ms: f64,
) -> CodexUsageResult {
    let base = RateStatus::base("codex", fetched_at_ms);
    let Some(auth) = auth else {
        return fail(base, RateError::NoCredentials);
    };
    let bearer = format!("Bearer {}", auth.access_token);
    let res = transport.send(&HttpRequest {
        method: "GET",
        url: USAGE_URL,
        headers: &[
            ("Authorization", bearer.as_str()),
            ("chatgpt-account-id", auth.account_id.as_str()),
            ("User-Agent", "codex-cli"),
        ],
        body: None,
    });
    let res = match res {
        Ok(r) => r,
        Err(()) => return fail(base, RateError::Network),
    };
    if res.status == 401 || res.status == 403 {
        return fail(base, RateError::Unauthorized);
    }
    if !(200..300).contains(&res.status) {
        return fail(base, RateError::Network);
    }
    let body: Value = match serde_json::from_str(&res.body) {
        Ok(v) => v,
        Err(_) => return fail(base, RateError::Network),
    };
    if !body.is_object() {
        return fail(base, RateError::NoData); // v1: body가 null 등 비객체면 no-data
    }
    let account = CodexAccountIdentity {
        id: body["account_id"].as_str().unwrap_or(&auth.account_id).to_string(),
        email: body["email"].as_str().unwrap_or("").to_string(),
        plan: body["plan_type"].as_str().map(String::from),
    };
    let mut windows: Vec<RateWindow> = [
        to_window(&body["rate_limit"]["primary_window"]),
        to_window(&body["rate_limit"]["secondary_window"]),
    ]
    .into_iter()
    .flatten()
    .collect();
    windows.sort_by_key(|w| if w.kind == "session_5h" { 0 } else { 1 }); // 표시 순서: 세션 → 주간
    let error = if windows.is_empty() { Some(RateError::NoData) } else { None };
    let plan = account.plan.clone();
    CodexUsageResult {
        account: Some(account),
        status: RateStatus { windows, plan, error, ..base },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::http::testing::MockTransport;

    fn auth() -> CodexAuth {
        CodexAuth { access_token: "FAKE-AT".into(), account_id: "acc-header".into() }
    }

    const OK_BODY: &str = r#"{
        "account_id": "acc-body", "email": "u@c.com", "plan_type": "plus",
        "rate_limit": {
            "primary_window": { "used_percent": 12.5, "limit_window_seconds": 604800, "reset_at": 111 },
            "secondary_window": { "used_percent": 44, "limit_window_seconds": 18000, "reset_at": 222 }
        }
    }"#;

    #[test]
    fn maps_account_windows_and_sorts_session_first() {
        let t = MockTransport::returning(200, OK_BODY);
        let r = fetch_codex_usage(&t, Some(&auth()), 5000.0);
        let acc = r.account.unwrap();
        assert_eq!(acc.id, "acc-body"); // body가 header보다 우선
        assert_eq!(acc.email, "u@c.com");
        assert_eq!(acc.plan.as_deref(), Some("plus"));
        assert_eq!(r.status.plan.as_deref(), Some("plus"));
        assert_eq!(r.status.error, None);
        // primary가 weekly, secondary가 session이어도 세션이 먼저 (v1 정렬 규칙)
        assert_eq!(r.status.windows[0].kind, "session_5h");
        assert_eq!(r.status.windows[0].used_percent, 44.0);
        assert_eq!(r.status.windows[0].resets_at, 222.0);
        assert_eq!(r.status.windows[1].kind, "weekly");
    }

    #[test]
    fn sends_exact_headers() {
        let t = MockTransport::returning(200, OK_BODY);
        fetch_codex_usage(&t, Some(&auth()), 0.0);
        let reqs = t.requests.borrow();
        assert_eq!(reqs[0].url, "https://chatgpt.com/backend-api/wham/usage");
        assert!(reqs[0].headers.contains(&("Authorization".into(), "Bearer FAKE-AT".into())));
        assert!(reqs[0].headers.contains(&("chatgpt-account-id".into(), "acc-header".into())));
        assert!(reqs[0].headers.contains(&("User-Agent".into(), "codex-cli".into())));
    }

    #[test]
    fn account_id_falls_back_to_auth_and_email_to_empty() {
        let body = r#"{"rate_limit":{"primary_window":{"used_percent":1,"limit_window_seconds":18000}}}"#;
        let t = MockTransport::returning(200, body);
        let r = fetch_codex_usage(&t, Some(&auth()), 0.0);
        let acc = r.account.unwrap();
        assert_eq!(acc.id, "acc-header");
        assert_eq!(acc.email, "");
        assert_eq!(acc.plan, None);
        assert_eq!(r.status.windows[0].resets_at, 0.0); // reset_at 결측 → 0
    }

    #[test]
    fn unknown_window_seconds_dropped_and_empty_is_no_data() {
        let body = r#"{"rate_limit":{"primary_window":{"used_percent":1,"limit_window_seconds":3600}}}"#;
        let t = MockTransport::returning(200, body);
        let r = fetch_codex_usage(&t, Some(&auth()), 0.0);
        assert!(r.status.windows.is_empty());
        assert_eq!(r.status.error, Some(RateError::NoData));
        assert!(r.account.is_some()); // 계정 신원은 창과 무관하게 나온다
    }

    #[test]
    fn no_auth_is_no_credentials_without_network() {
        let t = MockTransport::returning(200, OK_BODY);
        let r = fetch_codex_usage(&t, None, 0.0);
        assert_eq!(r.status.error, Some(RateError::NoCredentials));
        assert!(r.account.is_none());
        assert_eq!(t.call_count(), 0);
    }

    #[test]
    fn failures_map_like_v1() {
        for (status, expected) in
            [(401, RateError::Unauthorized), (403, RateError::Unauthorized), (500, RateError::Network)]
        {
            let t = MockTransport::returning(status, "{}");
            let r = fetch_codex_usage(&t, Some(&auth()), 0.0);
            assert_eq!(r.status.error, Some(expected));
            assert!(r.account.is_none());
        }
        let t = MockTransport::erroring();
        assert_eq!(fetch_codex_usage(&t, Some(&auth()), 0.0).status.error, Some(RateError::Network));
        let t = MockTransport::returning(200, "not-json");
        assert_eq!(fetch_codex_usage(&t, Some(&auth()), 0.0).status.error, Some(RateError::Network));
        let t = MockTransport::returning(200, "null"); // 유효 JSON이지만 비객체
        assert_eq!(fetch_codex_usage(&t, Some(&auth()), 0.0).status.error, Some(RateError::NoData));
    }
}
