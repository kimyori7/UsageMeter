// 토큰 갱신 — v1 providers/claude/refresh.ts 이식.
// 토큰 값은 이 모듈 경계 밖(로그/IPC/에러메시지)으로 절대 내보내지 말 것.
// v1의 single-flight는 이식하지 않는다(설계 D3) — v2 호출자는 폴러 스레드 하나뿐. freshCache는 이식.
use crate::providers::claude::credentials::{read_claude_credentials, write_claude_oauth_update};
use crate::providers::http::{HttpRequest, Transport};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// Claude Code CLI가 사용하는 공개 OAuth client id. 앱 자체 발급 client가 아니라 Claude Code와
// 동일한 값을 써야 refresh_token grant가 그 세션과 호환된다.
pub const CLAUDE_CODE_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REFRESH_URL: &str = "https://console.anthropic.com/v1/oauth/token";
const SKEW_MS: f64 = 5.0 * 60.0 * 1000.0; // 만료 5분 전부터 "곧 만료"로 취급해 미리 갱신

struct FreshResult {
    access_token: String,
    expires_at: f64, // epoch ms
}

/// cred_path별 최근 성공 갱신 캐시(v1 freshCache) — 파일이 외부에서 과거 값으로 남아 있어도
/// 더 미래의 expiresAt을 신뢰하기 위한 것.
pub struct TokenRefresher {
    fresh_cache: Mutex<HashMap<PathBuf, FreshResult>>,
}

/// expiresAt이 없으면 판정 불가 → 신선한 것으로 취급(갱신 시도 안 함) — v1 동일.
fn is_still_fresh(expires_at: Option<f64>, now_ms: f64) -> bool {
    match expires_at {
        None => true,
        Some(e) => e - SKEW_MS > now_ms,
    }
}

impl Default for TokenRefresher {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenRefresher {
    pub fn new() -> Self {
        Self { fresh_cache: Mutex::new(HashMap::new()) }
    }

    /// 파일 토큰이 유효하면(만료까지 SKEW_MS 초과) 네트워크 없이 반환. 만료(임박)이고 refreshToken이
    /// 있으면 갱신을 시도해 성공 시 파일에 원자 반영 후 새 토큰 반환. 실패(4xx/5xx/전송 오류/파싱
    /// 실패)는 항상 None이고 파일 불변 (v1: 절대 throw하지 않음 = 절대 panic하지 않음).
    pub fn ensure_fresh_token(
        &self,
        cred_path: &Path,
        transport: &dyn Transport,
        now_ms: f64,
    ) -> Option<String> {
        let file = read_claude_credentials(cred_path)?;

        // 파일과 메모리 캐시 중 expiresAt이 더 미래인 쪽을 신뢰한다(외부에서 파일이 갱신됐을 수 있으므로).
        let mut current_token = file.oauth.access_token.clone();
        let mut current_expires = file.oauth.expires_at;
        {
            let cache = self.fresh_cache.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(cached) = cache.get(cred_path) {
                if cached.expires_at > current_expires.unwrap_or(f64::NEG_INFINITY) {
                    current_token = Some(cached.access_token.clone());
                    current_expires = Some(cached.expires_at);
                }
            }
        }

        if is_still_fresh(current_expires, now_ms) {
            return current_token;
        }
        let Some(refresh_token) = file.oauth.refresh_token.as_deref() else {
            return current_token; // 갱신 불가 — 있는 그대로 반환(호출자가 401로 판정) — v1 동일
        };

        let result = request_refresh(cred_path, &file.raw, refresh_token, transport, now_ms)?;
        let token = result.access_token.clone();
        self.fresh_cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(cred_path.to_path_buf(), result);
        Some(token)
    }
}

fn request_refresh(
    cred_path: &Path,
    raw: &Value,
    refresh_token: &str,
    transport: &dyn Transport,
    now_ms: f64,
) -> Option<FreshResult> {
    let body = serde_json::json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLAUDE_CODE_CLIENT_ID,
    })
    .to_string();
    let res = transport
        .send(&HttpRequest {
            method: "POST",
            url: REFRESH_URL,
            headers: &[("Content-Type", "application/json")],
            body: Some(&body),
        })
        .ok()?;
    if !(200..300).contains(&res.status) {
        return None;
    }
    let parsed: Value = serde_json::from_str(&res.body).ok()?;
    let access_token = parsed["access_token"].as_str()?;
    let expires_in = parsed["expires_in"].as_f64()?;
    let rotated = parsed["refresh_token"].as_str();

    let expires_at_ms = now_ms + expires_in * 1000.0;
    // 회전(refresh_token 포함) 시 파일에 반영, 없으면 access/expiresAt만 — 원본 구조는 보존.
    write_claude_oauth_update(cred_path, raw, access_token, rotated, expires_at_ms as i64).ok()?;
    Some(FreshResult { access_token: access_token.to_string(), expires_at: expires_at_ms })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::http::testing::MockTransport;
    use std::fs;

    // 모든 토큰 값은 명백한 가짜(FAKE-*). 실계정 파일(~/.claude)은 절대 건드리지 않는다 —
    // cred_path는 매번 새 임시 디렉터리, default_cred_path()는 쓰지 않는다.
    const NOW: f64 = 1_800_000_000_000.0; // 고정 기준 시각(epoch-ms)
    const FIVE_MIN_MS: f64 = 5.0 * 60.0 * 1000.0;

    fn cred_json(expires_at: Option<f64>, refresh: bool) -> String {
        let mut oauth = serde_json::json!({
            "accessToken": "FAKE-ACCESS-OLD",
            "scopes": ["user:inference", "user:profile"],
            "subscriptionType": "max"
        });
        if refresh {
            oauth["refreshToken"] = "FAKE-REFRESH-OLD".into();
        }
        if let Some(e) = expires_at {
            oauth["expiresAt"] = serde_json::Number::from_f64(e).unwrap().into();
        }
        serde_json::json!({
            "claudeAiOauth": oauth,
            "unrelatedField": { "keep": "me", "korean": "한글 값도 보존되어야 함" }
        })
        .to_string()
    }

    const ROTATED_BODY: &str = r#"{"access_token":"FAKE-ACCESS-NEW","refresh_token":"FAKE-REFRESH-NEW","expires_in":28800}"#;

    struct Fx {
        _dir: tempfile::TempDir,
        cred_path: PathBuf,
    }

    fn fx(cred_text: &str) -> Fx {
        let dir = tempfile::tempdir().unwrap();
        let cred_path = dir.path().join(".credentials.json");
        fs::write(&cred_path, cred_text).unwrap();
        Fx { _dir: dir, cred_path }
    }

    #[test]
    fn fresh_token_returns_without_network() {
        let f = fx(&cred_json(Some(NOW + 10.0 * 60_000.0), true));
        let t = MockTransport::returning(200, ROTATED_BODY);
        let token = TokenRefresher::new().ensure_fresh_token(&f.cred_path, &t, NOW);
        assert_eq!(token.as_deref(), Some("FAKE-ACCESS-OLD"));
        assert_eq!(t.call_count(), 0);
    }

    #[test]
    fn missing_expires_at_is_treated_as_fresh() {
        let f = fx(&cred_json(None, true));
        let t = MockTransport::returning(200, ROTATED_BODY);
        let token = TokenRefresher::new().ensure_fresh_token(&f.cred_path, &t, NOW);
        assert_eq!(token.as_deref(), Some("FAKE-ACCESS-OLD"));
        assert_eq!(t.call_count(), 0);
    }

    #[test]
    fn expired_without_refresh_token_returns_as_is() {
        let f = fx(&cred_json(Some(NOW - 1000.0), false));
        let t = MockTransport::returning(200, ROTATED_BODY);
        let token = TokenRefresher::new().ensure_fresh_token(&f.cred_path, &t, NOW);
        assert_eq!(token.as_deref(), Some("FAKE-ACCESS-OLD"));
        assert_eq!(t.call_count(), 0);
    }

    #[test]
    fn missing_file_is_none_without_network() {
        let dir = tempfile::tempdir().unwrap();
        let t = MockTransport::returning(200, ROTATED_BODY);
        let token =
            TokenRefresher::new().ensure_fresh_token(&dir.path().join("no.json"), &t, NOW);
        assert_eq!(token, None);
        assert_eq!(t.call_count(), 0);
    }

    #[test]
    fn refresh_post_payload_is_exact() {
        let f = fx(&cred_json(Some(NOW - 1000.0), true));
        let t = MockTransport::returning(200, ROTATED_BODY);
        TokenRefresher::new().ensure_fresh_token(&f.cred_path, &t, NOW);
        let reqs = t.requests.borrow();
        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].method, "POST");
        assert_eq!(reqs[0].url, "https://console.anthropic.com/v1/oauth/token");
        assert!(reqs[0]
            .headers
            .contains(&("Content-Type".to_string(), "application/json".to_string())));
        let body: Value = serde_json::from_str(reqs[0].body.as_deref().unwrap()).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "grant_type": "refresh_token",
                "refresh_token": "FAKE-REFRESH-OLD",
                "client_id": CLAUDE_CODE_CLIENT_ID
            })
        );
    }

    #[test]
    fn near_expiry_within_skew_also_refreshes() {
        let f = fx(&cred_json(Some(NOW + FIVE_MIN_MS - 60_000.0), true));
        let t = MockTransport::returning(200, ROTATED_BODY);
        let token = TokenRefresher::new().ensure_fresh_token(&f.cred_path, &t, NOW);
        assert_eq!(token.as_deref(), Some("FAKE-ACCESS-NEW"));
        assert_eq!(t.call_count(), 1);
    }

    #[test]
    fn rotation_updates_file_preserving_structure_no_tmp_residue() {
        let f = fx(&cred_json(Some(NOW - 1000.0), true));
        let token = TokenRefresher::new().ensure_fresh_token(
            &f.cred_path,
            &MockTransport::returning(200, ROTATED_BODY),
            NOW,
        );
        assert_eq!(token.as_deref(), Some("FAKE-ACCESS-NEW"));
        let updated: Value = serde_json::from_str(&fs::read_to_string(&f.cred_path).unwrap()).unwrap();
        assert_eq!(updated["claudeAiOauth"]["accessToken"], "FAKE-ACCESS-NEW");
        assert_eq!(updated["claudeAiOauth"]["refreshToken"], "FAKE-REFRESH-NEW");
        assert_eq!(updated["claudeAiOauth"]["expiresAt"], (NOW + 28800.0 * 1000.0) as i64);
        assert_eq!(updated["claudeAiOauth"]["subscriptionType"], "max");
        assert_eq!(updated["unrelatedField"]["korean"], "한글 값도 보존되어야 함");
        let names: Vec<String> = fs::read_dir(f._dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![".credentials.json".to_string()]); // 원자 쓰기: tmp 잔재 없음
    }

    #[test]
    fn non_rotation_keeps_existing_refresh_token() {
        let f = fx(&cred_json(Some(NOW - 1000.0), true));
        let body = r#"{"access_token":"FAKE-ACCESS-NEW","expires_in":3600}"#;
        let token = TokenRefresher::new().ensure_fresh_token(
            &f.cred_path,
            &MockTransport::returning(200, body),
            NOW,
        );
        assert_eq!(token.as_deref(), Some("FAKE-ACCESS-NEW"));
        let updated: Value = serde_json::from_str(&fs::read_to_string(&f.cred_path).unwrap()).unwrap();
        assert_eq!(updated["claudeAiOauth"]["refreshToken"], "FAKE-REFRESH-OLD");
        assert_eq!(updated["claudeAiOauth"]["expiresAt"], (NOW + 3600.0 * 1000.0) as i64);
    }

    #[test]
    fn failures_return_none_and_leave_file_unchanged() {
        // (설명, MockTransport 구성) — v1의 실패 6종 이식
        let cases: Vec<(&str, MockTransport)> = vec![
            ("4xx", MockTransport::returning(400, r#"{"error":"invalid_grant"}"#)),
            ("5xx", MockTransport::returning(500, "{}")),
            ("transport err", MockTransport::erroring()),
            ("non-json 200", MockTransport::returning(200, "not-json")),
            ("missing access_token", MockTransport::returning(200, r#"{"expires_in":3600}"#)),
            (
                "non-number expires_in",
                MockTransport::returning(200, r#"{"access_token":"FAKE-X","expires_in":"soon"}"#),
            ),
        ];
        for (label, transport) in cases {
            let f = fx(&cred_json(Some(NOW - 1000.0), true));
            let before = fs::read_to_string(&f.cred_path).unwrap();
            let token = TokenRefresher::new().ensure_fresh_token(&f.cred_path, &transport, NOW);
            assert_eq!(token, None, "{label}");
            assert_eq!(fs::read_to_string(&f.cred_path).unwrap(), before, "{label}");
        }
    }

    #[test]
    fn failure_does_not_stick_next_call_retries_network() {
        let f = fx(&cred_json(Some(NOW - 1000.0), true));
        let t = MockTransport::with(vec![
            Ok(crate::providers::http::HttpResponse { status: 500, body: "{}".into() }),
            Ok(crate::providers::http::HttpResponse { status: 500, body: "{}".into() }),
        ]);
        let r = TokenRefresher::new();
        assert_eq!(r.ensure_fresh_token(&f.cred_path, &t, NOW), None);
        assert_eq!(r.ensure_fresh_token(&f.cred_path, &t, NOW), None);
        assert_eq!(t.call_count(), 2);
    }

    #[test]
    fn success_then_second_call_needs_no_network() {
        let f = fx(&cred_json(Some(NOW - 1000.0), true));
        let t = MockTransport::returning(200, ROTATED_BODY);
        let r = TokenRefresher::new();
        assert_eq!(r.ensure_fresh_token(&f.cred_path, &t, NOW).as_deref(), Some("FAKE-ACCESS-NEW"));
        assert_eq!(r.ensure_fresh_token(&f.cred_path, &t, NOW).as_deref(), Some("FAKE-ACCESS-NEW"));
        assert_eq!(t.call_count(), 1); // 파일이 이미 신선해짐 + 캐시
    }

    #[test]
    fn external_file_update_with_later_expiry_wins_over_cache() {
        let f = fx(&cred_json(Some(NOW - 1000.0), true));
        let t = MockTransport::returning(200, ROTATED_BODY);
        let r = TokenRefresher::new();
        assert_eq!(r.ensure_fresh_token(&f.cred_path, &t, NOW).as_deref(), Some("FAKE-ACCESS-NEW")); // 캐시 형성

        // 외부(Claude Code 등)가 더 미래 expiresAt으로 파일 갱신
        let external = serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "FAKE-ACCESS-EXTERNAL",
                "refreshToken": "FAKE-REFRESH-EXTERNAL",
                "expiresAt": NOW + 28800.0 * 1000.0 + 60_000.0
            }
        });
        fs::write(&f.cred_path, external.to_string()).unwrap();
        assert_eq!(
            r.ensure_fresh_token(&f.cred_path, &t, NOW).as_deref(),
            Some("FAKE-ACCESS-EXTERNAL")
        );
        assert_eq!(t.call_count(), 1); // 추가 네트워크 호출 없음
    }
}
