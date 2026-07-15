// 설정 JSON 로드/저장 — v1 app/src/main/settings.ts의 1:1 이식 (%APPDATA%\UsageMeter\settings.json).
// autoStart의 로그인 항목 등록 부수효과는 5단계 범위 — 여기서는 파일 I/O만.
// 값이 너무 작으면 폴러 타이머가 간격 없이 돌며 API를 폭주시킨다 — 로드·저장 양쪽에서 clamp.
use serde_json::{json, Value};
use std::path::Path;

const MIN_LIMITS_INTERVAL_SEC: i64 = 15;
const MIN_USAGE_INTERVAL_MIN: i64 = 1;
const DEFAULT_LIMITS_INTERVAL_SEC: f64 = 300.0;
const DEFAULT_USAGE_INTERVAL_MIN: f64 = 5.0;

/// typeof 내로잉 + 기본값 대체 + 최소치 clamp를 한 곳에서. 로드(디스크의 손상 가능 JSON)와
/// 저장(렌더러발 IPC payload — 런타임엔 사실상 unknown) 양쪽 경로가 반드시 이 함수를 통과한다.
pub fn normalize(raw: &Value) -> Value {
    let auto_start = raw.get("autoStart").and_then(Value::as_bool).unwrap_or(false);
    let limits = raw
        .get("limitsIntervalSec")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .unwrap_or(DEFAULT_LIMITS_INTERVAL_SEC);
    let usage = raw
        .get("usageIntervalMin")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .unwrap_or(DEFAULT_USAGE_INTERVAL_MIN);
    json!({
        "autoStart": auto_start,
        "limitsIntervalSec": (limits.round() as i64).max(MIN_LIMITS_INTERVAL_SEC),
        "usageIntervalMin": (usage.round() as i64).max(MIN_USAGE_INTERVAL_MIN),
    })
}

pub fn load_settings_from(dir: &Path) -> Value {
    let raw = std::fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .unwrap_or(Value::Null);
    normalize(&raw)
}

pub fn save_settings_to(dir: &Path, s: &Value) -> std::io::Result<Value> {
    let normalized = normalize(s);
    std::fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(&normalized).expect("Value 직렬화는 실패하지 않는다");
    std::fs::write(dir.join("settings.json"), text)?;
    Ok(normalized)
}

pub fn load_settings() -> Value {
    load_settings_from(&crate::paths::data_dir())
}

pub fn save_settings(s: &Value) -> std::io::Result<Value> {
    save_settings_to(&crate::paths::data_dir(), s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn load_missing_file_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let v = load_settings_from(dir.path());
        assert_eq!(v, json!({ "autoStart": false, "limitsIntervalSec": 300, "usageIntervalMin": 5 }));
    }

    #[test]
    fn load_corrupt_json_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), "not json{{{").unwrap();
        let v = load_settings_from(dir.path());
        assert_eq!(v["limitsIntervalSec"], 300);
    }

    #[test]
    fn normalize_clamps_and_rounds() {
        let v = normalize(&json!({ "autoStart": "yes", "limitsIntervalSec": 3.4, "usageIntervalMin": 0 }));
        assert_eq!(v["autoStart"], false); // 문자열 → 기본값
        assert_eq!(v["limitsIntervalSec"], 15); // round(3.4)=3 → clamp 15
        assert_eq!(v["usageIntervalMin"], 1); // 0 → clamp 1
    }

    #[test]
    fn save_returns_normalized_and_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let saved = save_settings_to(dir.path(), &json!({ "autoStart": true, "limitsIntervalSec": 60, "usageIntervalMin": 10 })).unwrap();
        assert_eq!(saved, json!({ "autoStart": true, "limitsIntervalSec": 60, "usageIntervalMin": 10 }));
        let loaded = load_settings_from(dir.path());
        assert_eq!(loaded, saved);
    }

    #[test]
    fn save_creates_directory() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("does").join("not").join("exist");
        save_settings_to(&nested, &json!({})).unwrap();
        assert!(nested.join("settings.json").exists());
    }

    #[test]
    fn clamp_exact_boundaries() {
        // P2 이월: clamp 최소치의 정확 경계 — 15/1은 그대로, 바로 아래는 끌어올림
        let v = normalize(&json!({ "limitsIntervalSec": 15, "usageIntervalMin": 1 }));
        assert_eq!(v["limitsIntervalSec"], 15);
        assert_eq!(v["usageIntervalMin"], 1);
        let v = normalize(&json!({ "limitsIntervalSec": 14, "usageIntervalMin": 0.4 }));
        assert_eq!(v["limitsIntervalSec"], 15);
        assert_eq!(v["usageIntervalMin"], 1);
        let v = normalize(&json!({ "limitsIntervalSec": 16, "usageIntervalMin": 2 }));
        assert_eq!(v["limitsIntervalSec"], 16);
        assert_eq!(v["usageIntervalMin"], 2);
    }
}
