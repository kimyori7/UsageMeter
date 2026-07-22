// 클로드 한도 조회 — v1 providers/claude/limits.ts 이식 (스펙 §클로드 provider 계약).
// 계약: 절대 panic하지 않고 RateStatus.error로 실패를 알린다. 토큰은 요청 헤더에만 쓰고 버린다.
use crate::providers::http::{HttpRequest, Transport};
use crate::providers::types::{RateError, RateStatus, RateWindow};
use serde_json::Value;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

/// v1 toEpochSec: 숫자는 ms(>1e12)면 sec로 반올림 변환, 문자열은 RFC3339 파싱(설계 D6, 실패 시 0).
fn to_epoch_sec(v: &Value) -> f64 {
    if let Some(n) = v.as_f64() {
        return if n > 1e12 { (n / 1000.0).round() } else { n };
    }
    if let Some(s) = v.as_str() {
        if let Ok(t) =
            time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339)
        {
            return (t.unix_timestamp_nanos() as f64 / 1_000_000_000.0).round();
        }
    }
    0.0
}

fn win(kind: &str, raw: &Value) -> Option<RateWindow> {
    let used = raw["utilization"].as_f64()?;
    Some(RateWindow {
        kind: kind.to_string(),
        used_percent: used,
        resets_at: to_epoch_sec(&raw["resets_at"]),
    })
}

/// "Fable" → "weekly_fable" — DB(window 컬럼)·렌더러가 이 kind 문자열로 창을 식별한다.
fn scoped_kind(display_name: &str) -> String {
    let slug: String = display_name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    format!("weekly_{slug}")
}

/// 새 limits[] 배열에서 모델 스코프 주간 창(weekly_scoped, 예: Fable 주간 한도)만 취한다.
/// session/weekly_all 항목은 레거시 five_hour/seven_day와 중복이라 제외. 모델명이 없는
/// 스코프 항목(surface 스코프 등)은 건너뛴다.
fn scoped_windows(body: &Value) -> Vec<RateWindow> {
    let empty = vec![];
    body["limits"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .filter(|l| l["kind"].as_str() == Some("weekly_scoped"))
        .filter_map(|l| {
            let name = l["scope"]["model"]["display_name"].as_str()?;
            Some(RateWindow {
                kind: scoped_kind(name),
                used_percent: l["percent"].as_f64()?,
                resets_at: to_epoch_sec(&l["resets_at"]),
            })
        })
        .collect()
}

pub fn fetch_claude_limits(
    transport: &dyn Transport,
    token: Option<&str>,
    fetched_at_ms: f64,
) -> RateStatus {
    let base = RateStatus::base("claude", fetched_at_ms);
    let Some(token) = token else {
        return RateStatus { error: Some(RateError::NoCredentials), ..base };
    };
    let auth = format!("Bearer {token}");
    let res = transport.send(&HttpRequest {
        method: "GET",
        url: USAGE_URL,
        headers: &[("Authorization", auth.as_str()), ("anthropic-beta", "oauth-2025-04-20")],
        body: None,
    });
    let res = match res {
        Ok(r) => r,
        Err(()) => return RateStatus { error: Some(RateError::Network), ..base },
    };
    if res.status == 401 || res.status == 403 {
        return RateStatus { error: Some(RateError::Unauthorized), ..base };
    }
    if !(200..300).contains(&res.status) {
        return RateStatus { error: Some(RateError::Network), ..base };
    }
    let body: Value = match serde_json::from_str(&res.body) {
        Ok(v) => v,
        Err(_) => return RateStatus { error: Some(RateError::Network), ..base },
    };
    let mut windows: Vec<RateWindow> =
        [win("session_5h", &body["five_hour"]), win("weekly", &body["seven_day"])]
            .into_iter()
            .flatten()
            .collect();
    windows.extend(scoped_windows(&body));
    let plan = body["subscriptionType"].as_str().map(String::from);
    let error = if windows.is_empty() { Some(RateError::NoData) } else { None };
    RateStatus { windows, plan, error, ..base }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::http::testing::MockTransport;

    // epoch 상수: 2026-07-13T09:00:00Z = 1783933200, 2026-07-17T00:00:00Z = 1784246400
    const OK_BODY: &str = r#"{
        "five_hour": { "utilization": 68, "resets_at": "2026-07-13T09:00:00Z" },
        "seven_day": { "utilization": 41, "resets_at": "2026-07-17T00:00:00Z" },
        "subscriptionType": "max_20x"
    }"#;

    #[test]
    fn maps_windows_plan_and_iso_resets_at() {
        let t = MockTransport::returning(200, OK_BODY);
        let s = fetch_claude_limits(&t, Some("FAKE-TOKEN"), 5000.0);
        assert_eq!(s.error, None);
        assert_eq!(s.plan.as_deref(), Some("max_20x"));
        assert_eq!(s.fetched_at, 5000.0);
        assert_eq!(
            s.windows,
            vec![
                RateWindow {
                    kind: "session_5h".into(),
                    used_percent: 68.0,
                    resets_at: 1783933200.0
                },
                RateWindow { kind: "weekly".into(), used_percent: 41.0, resets_at: 1784246400.0 },
            ]
        );
    }

    // 실 응답(2026-07-22 관측) 축약: limits[]에 session/weekly_all(레거시 필드와 중복)과
    // 모델 스코프 주간 창(Fable)이 함께 온다. epoch: 2026-07-28T11:00:00Z = 1785236400
    const SCOPED_BODY: &str = r#"{
        "five_hour": { "utilization": 37, "resets_at": "2026-07-22T12:09:59Z" },
        "seven_day": { "utilization": 18, "resets_at": "2026-07-28T10:59:59Z" },
        "limits": [
            { "kind": "session", "group": "session", "percent": 37,
              "resets_at": "2026-07-22T12:09:59Z", "scope": null },
            { "kind": "weekly_all", "group": "weekly", "percent": 18,
              "resets_at": "2026-07-28T10:59:59Z", "scope": null },
            { "kind": "weekly_scoped", "group": "weekly", "percent": 24,
              "resets_at": "2026-07-28T11:00:00Z",
              "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null } },
            { "kind": "weekly_scoped", "group": "weekly", "percent": 99,
              "resets_at": "2026-07-28T11:00:00Z",
              "scope": { "model": null, "surface": "cowork" } }
        ]
    }"#;

    #[test]
    fn maps_model_scoped_weekly_windows_from_limits_array() {
        let t = MockTransport::returning(200, SCOPED_BODY);
        let s = fetch_claude_limits(&t, Some("FAKE"), 0.0);
        assert_eq!(s.error, None);
        // 레거시 두 창 + Fable 스코프 창. session/weekly_all은 중복이라 다시 세지 않고,
        // 모델 없는 스코프 항목(surface)은 건너뛴다.
        assert_eq!(s.windows.len(), 3);
        assert_eq!(
            s.windows[2],
            RateWindow { kind: "weekly_fable".into(), used_percent: 24.0, resets_at: 1785236400.0 }
        );
    }

    #[test]
    fn scoped_kind_slug_is_lowercase_alnum() {
        assert_eq!(scoped_kind("Fable"), "weekly_fable");
        assert_eq!(scoped_kind("Opus 4.5"), "weekly_opus_4_5"); // 공백·점 → '_'
    }

    #[test]
    fn body_without_limits_array_keeps_legacy_windows_only() {
        let t = MockTransport::returning(200, OK_BODY);
        let s = fetch_claude_limits(&t, Some("FAKE"), 0.0);
        assert_eq!(s.windows.len(), 2); // 기존 응답 형태에서 회귀 없음
    }

    #[test]
    fn sends_exact_headers_and_url() {
        let t = MockTransport::returning(200, OK_BODY);
        fetch_claude_limits(&t, Some("FAKE-TOKEN"), 0.0);
        let reqs = t.requests.borrow();
        assert_eq!(reqs[0].method, "GET");
        assert_eq!(reqs[0].url, "https://api.anthropic.com/api/oauth/usage");
        assert!(reqs[0]
            .headers
            .contains(&("Authorization".to_string(), "Bearer FAKE-TOKEN".to_string())));
        assert!(reqs[0]
            .headers
            .contains(&("anthropic-beta".to_string(), "oauth-2025-04-20".to_string())));
    }

    #[test]
    fn numeric_resets_at_ms_is_rounded_to_sec_and_sec_passes_through() {
        let body = r#"{"five_hour":{"utilization":1,"resets_at":1783933200400.0},
                       "seven_day":{"utilization":2,"resets_at":1784246400}}"#;
        let t = MockTransport::returning(200, body);
        let s = fetch_claude_limits(&t, Some("FAKE"), 0.0);
        assert_eq!(s.windows[0].resets_at, 1783933200.0); // >1e12 → ms로 보고 반올림 sec
        assert_eq!(s.windows[1].resets_at, 1784246400.0); // sec 그대로
    }

    #[test]
    fn unparsable_resets_at_becomes_zero() {
        let body = r#"{"five_hour":{"utilization":1,"resets_at":"tomorrow"},
                       "seven_day":{"utilization":2}}"#;
        let t = MockTransport::returning(200, body);
        let s = fetch_claude_limits(&t, Some("FAKE"), 0.0);
        assert_eq!(s.windows[0].resets_at, 0.0);
        assert_eq!(s.windows[1].resets_at, 0.0); // 필드 부재도 0
    }

    #[test]
    fn missing_window_keeps_only_present_ones() {
        let body = r#"{"seven_day":{"utilization":41,"resets_at":"2026-07-17T00:00:00Z"}}"#;
        let t = MockTransport::returning(200, body);
        let s = fetch_claude_limits(&t, Some("FAKE"), 0.0);
        assert_eq!(s.windows.len(), 1);
        assert_eq!(s.windows[0].kind, "weekly");
        assert_eq!(s.error, None);
    }

    #[test]
    fn no_token_is_no_credentials_without_network() {
        let t = MockTransport::returning(200, OK_BODY);
        let s = fetch_claude_limits(&t, None, 0.0);
        assert_eq!(s.error, Some(RateError::NoCredentials));
        assert!(s.windows.is_empty());
        assert_eq!(t.call_count(), 0);
    }

    #[test]
    fn auth_failures_and_network_failures() {
        for (status, expected) in
            [(401, RateError::Unauthorized), (403, RateError::Unauthorized), (500, RateError::Network)]
        {
            let t = MockTransport::returning(status, "{}");
            assert_eq!(fetch_claude_limits(&t, Some("FAKE"), 0.0).error, Some(expected));
        }
        let t = MockTransport::erroring();
        assert_eq!(fetch_claude_limits(&t, Some("FAKE"), 0.0).error, Some(RateError::Network));
        let t = MockTransport::returning(200, "not json at all");
        assert_eq!(fetch_claude_limits(&t, Some("FAKE"), 0.0).error, Some(RateError::Network));
    }

    #[test]
    fn empty_windows_is_no_data() {
        let t = MockTransport::returning(200, "{}");
        let s = fetch_claude_limits(&t, Some("FAKE"), 0.0);
        assert_eq!(s.error, Some(RateError::NoData));
    }
}
