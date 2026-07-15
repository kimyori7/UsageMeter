// providers 공통 타입 — v1 app/src/providers/types.ts 이식.
// 렌더러 JSON 계약: camelCase, 없는 옵션 필드는 키 자체를 생략(v1 undefined 직렬화와 동일).
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateWindow {
    pub kind: String, // "session_5h" | "weekly"
    pub used_percent: f64,
    // epoch sec. v1(JS) number는 f64이고 실DB 스냅샷 폴백 경로가 REAL(소수부) 값을 나를 수 있어 f64 (설계 D2).
    pub resets_at: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum RateError {
    #[serde(rename = "no-credentials")]
    NoCredentials,
    #[serde(rename = "unauthorized")]
    Unauthorized,
    #[serde(rename = "network")]
    Network,
    #[serde(rename = "no-data")]
    NoData,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateStatus {
    pub provider: String, // "claude" | "codex"
    pub windows: Vec<RateWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    pub fetched_at: f64, // epoch ms (스냅샷 폴백 시 REAL 유산 수용 — 설계 D2)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RateError>,
}

impl RateStatus {
    /// 창 없는 기본 골격 (v1의 `base` 패턴).
    pub fn base(provider: &str, fetched_at_ms: f64) -> Self {
        Self {
            provider: provider.to_string(),
            windows: vec![],
            plan: None,
            fetched_at: fetched_at_ms,
            stale: None,
            error: None,
        }
    }

    pub fn with_error(provider: &str, fetched_at_ms: f64, error: RateError) -> Self {
        Self { error: Some(error), ..Self::base(provider, fetched_at_ms) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_camel_case_and_omits_absent_options() {
        let s = RateStatus {
            windows: vec![RateWindow {
                kind: "session_5h".into(),
                used_percent: 68.0,
                resets_at: 999.0,
            }],
            ..RateStatus::base("claude", 5000.0)
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["provider"], "claude");
        assert_eq!(v["windows"][0]["usedPercent"], 68.0);
        assert_eq!(v["windows"][0]["resetsAt"], 999.0);
        assert_eq!(v["fetchedAt"], 5000.0);
        assert!(v.get("plan").is_none()); // v1: undefined 필드는 키 생략
        assert!(v.get("stale").is_none());
        assert!(v.get("error").is_none());

        let e = RateStatus::with_error("codex", 1.0, RateError::NoCredentials);
        assert_eq!(serde_json::to_value(&e).unwrap()["error"], "no-credentials");
    }
}
