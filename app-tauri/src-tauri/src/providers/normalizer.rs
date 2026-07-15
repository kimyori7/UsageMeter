// ccusage CLI 원시 JSON → provider-agnostic DailyRow/SessionRow 변환 — v1 providers/usage-normalizer.ts 이식.
// 필드명은 실제 ccusage 출력 기준(v1에서 픽스처로 확정): claude=totalCost/modelBreakdowns 배열,
// codex=costUSD/models 객체. serde_json Value 인덱싱은 없는 키/비객체에서 Null을 돌려주므로
// JS 옵셔널 접근과 같은 무-panic 의미론이다.
use crate::store::daily::DailyRow;
use crate::store::sessions::SessionRow;
use serde_json::Value;

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0) // v1 num(): 숫자 아니면 0
}

fn int(v: &Value) -> i64 {
    v.as_f64().unwrap_or(0.0) as i64
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string() // v1 str(): 문자열 아니면 ''
}

fn s_or_none(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string) // v1 strOrNull()
}

/// claude만 modelBreakdowns에 모델별 cost가 있어 모델별 행으로 전개한다.
fn claude_daily_rows(day: &Value) -> Vec<DailyRow> {
    let empty = vec![];
    let breakdowns = day["modelBreakdowns"].as_array().unwrap_or(&empty);
    breakdowns
        .iter()
        .map(|mb| DailyRow {
            date: s(&day["date"]),
            provider: "claude".into(),
            model: s(&mb["modelName"]),
            input_tokens: int(&mb["inputTokens"]),
            output_tokens: int(&mb["outputTokens"]),
            cache_tokens: int(&mb["cacheCreationTokens"]) + int(&mb["cacheReadTokens"]),
            cost_usd: num(&mb["cost"]),
        })
        .collect()
}

/// codex의 models 엔트리에는 모델별 cost가 없어(day.costUSD만 존재) 전개하지 않고 하루 한 행.
/// model 필드는 등장한 모델명을 합쳐 표시 — preserve_order Map이라 JSON 문서 순서 유지(v1 Object.keys 동일).
fn codex_daily_row(day: &Value) -> DailyRow {
    let model_names: Vec<&str> = day["models"]
        .as_object()
        .map(|m| m.keys().map(String::as_str).collect())
        .unwrap_or_default();
    DailyRow {
        date: s(&day["date"]),
        provider: "codex".into(),
        model: model_names.join(", "),
        input_tokens: int(&day["inputTokens"]),
        output_tokens: int(&day["outputTokens"]),
        cache_tokens: int(&day["cacheCreationTokens"]) + int(&day["cacheReadTokens"]),
        cost_usd: num(&day["costUSD"]),
    }
}

pub fn normalize_daily(provider: &str, cli_json: &Value) -> Vec<DailyRow> {
    let empty = vec![];
    let days = cli_json["daily"].as_array().unwrap_or(&empty);
    if provider == "claude" {
        days.iter().flat_map(claude_daily_rows).collect()
    } else {
        days.iter().map(codex_daily_row).collect()
    }
}

fn claude_session_row(sess: &Value) -> SessionRow {
    SessionRow {
        session_id: s(&sess["sessionId"]),
        provider: "claude".into(),
        folder: s(&sess["projectPath"]),
        started_at: s_or_none(&sess["firstActivity"]),
        ended_at: s_or_none(&sess["lastActivity"]),
        total_tokens: int(&sess["totalTokens"]),
        cost_usd: num(&sess["totalCost"]),
    }
}

/// directory는 sessions 루트 밑 날짜 폴더, sessionFile은 확장자 없는 베이스네임 — cwd 리졸버가 해석.
fn codex_session_row(
    sess: &Value,
    cwd_of: Option<&dyn Fn(&str, &str) -> Option<String>>,
) -> SessionRow {
    let folder = cwd_of
        .and_then(|f| f(&s(&sess["directory"]), &s(&sess["sessionFile"])))
        .unwrap_or_else(|| "(폴더 미지정)".to_string());
    SessionRow {
        session_id: s(&sess["sessionId"]),
        provider: "codex".into(),
        folder,
        started_at: None, // codex 로그에는 세션 시작 시각이 없음(lastActivity만 존재)
        ended_at: s_or_none(&sess["lastActivity"]),
        total_tokens: int(&sess["totalTokens"]),
        cost_usd: num(&sess["costUSD"]),
    }
}

pub fn normalize_sessions(
    provider: &str,
    cli_json: &Value,
    codex_cwd_of: Option<&dyn Fn(&str, &str) -> Option<String>>,
) -> Vec<SessionRow> {
    let empty = vec![];
    let rows = cli_json["sessions"].as_array().unwrap_or(&empty);
    if provider == "claude" {
        rows.iter().map(claude_session_row).collect()
    } else {
        rows.iter().map(|r| codex_session_row(r, codex_cwd_of)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_daily_expands_model_breakdowns() {
        let j = json!({ "daily": [{
            "date": "2026-07-15",
            "totalCost": 9.99,
            "modelBreakdowns": [
                { "modelName": "opus", "cost": 7.5, "inputTokens": 100, "outputTokens": 200,
                  "cacheCreationTokens": 30, "cacheReadTokens": 40 },
                { "modelName": "sonnet", "cost": 2.49, "inputTokens": 10, "outputTokens": 20 }
            ]
        }]});
        let rows = normalize_daily("claude", &j);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].date, "2026-07-15");
        assert_eq!(rows[0].provider, "claude");
        assert_eq!(rows[0].model, "opus");
        assert_eq!(rows[0].cache_tokens, 70); // creation + read
        assert_eq!(rows[0].cost_usd, 7.5); // 톱레벨 totalCost가 아니라 모델별 cost
        assert_eq!(rows[1].cache_tokens, 0); // 캐시 필드 결측 → 0
    }

    #[test]
    fn codex_daily_is_single_row_with_joined_models() {
        let j = json!({ "daily": [{
            "date": "2026-07-15", "costUSD": 3.25,
            "inputTokens": 1000, "outputTokens": 2000,
            "models": { "gpt-5": {}, "gpt-5-mini": {} }
        }]});
        let rows = normalize_daily("codex", &j);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].model, "gpt-5, gpt-5-mini"); // 문서 순서 유지(preserve_order)
        assert_eq!(rows[0].cost_usd, 3.25);
        assert_eq!(rows[0].input_tokens, 1000);
        assert_eq!(rows[0].cache_tokens, 0);
    }

    #[test]
    fn daily_missing_or_wrong_shape_is_empty() {
        assert!(normalize_daily("claude", &Value::Null).is_empty());
        assert!(normalize_daily("codex", &json!({ "daily": 123 })).is_empty());
        assert!(normalize_daily("claude", &json!({})).is_empty());
    }

    #[test]
    fn claude_sessions_map_fields() {
        let j = json!({ "sessions": [{
            "sessionId": "abc", "projectPath": "D:\\proj", "totalCost": 1.5,
            "totalTokens": 999, "firstActivity": "2026-07-15T01:00:00Z",
            "lastActivity": "2026-07-15T02:00:00Z"
        }]});
        let rows = normalize_sessions("claude", &j, None);
        assert_eq!(rows[0].session_id, "abc");
        assert_eq!(rows[0].folder, "D:\\proj");
        assert_eq!(rows[0].started_at.as_deref(), Some("2026-07-15T01:00:00Z"));
        assert_eq!(rows[0].ended_at.as_deref(), Some("2026-07-15T02:00:00Z"));
        assert_eq!(rows[0].cost_usd, 1.5);
    }

    #[test]
    fn codex_sessions_resolve_folder_via_cwd_of() {
        let j = json!({ "sessions": [
            { "sessionId": "s1", "directory": "2026/07/15", "sessionFile": "rollout-x",
              "costUSD": 0.5, "totalTokens": 10, "lastActivity": "2026-07-15T03:00:00Z" },
            { "sessionId": "s2", "directory": "2026/07/14", "sessionFile": "rollout-y",
              "costUSD": 0.7, "totalTokens": 20 }
        ]});
        let resolver = |d: &str, f: &str| -> Option<String> {
            (d == "2026/07/15" && f == "rollout-x").then(|| "D:\\real-cwd".to_string())
        };
        let rows = normalize_sessions("codex", &j, Some(&resolver));
        assert_eq!(rows[0].folder, "D:\\real-cwd");
        assert_eq!(rows[0].started_at, None); // codex는 시작 시각 없음
        assert_eq!(rows[1].folder, "(폴더 미지정)"); // 리졸버가 None → 폴백
        // 리졸버 자체가 없어도 폴백
        let rows2 = normalize_sessions("codex", &j, None);
        assert_eq!(rows2[0].folder, "(폴더 미지정)");
    }

    #[test]
    fn sessions_missing_is_empty() {
        assert!(normalize_sessions("claude", &Value::Null, None).is_empty());
        assert!(normalize_sessions("codex", &json!({ "sessions": "x" }), None).is_empty());
    }
}
