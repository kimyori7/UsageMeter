// ~/.claude/.credentials.json 리더/구조 보존 라이터 — v1 providers/claude/credentials.ts 이식.
// 반환값(토큰)은 호출자(Rust 프로세스 메모리)에서만 사용. 로그·IPC로 내보내지 말 것.
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub fn default_cred_path() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").expect("USERPROFILE 없음"))
        .join(".claude")
        .join(".credentials.json")
}

/// expires_at=None은 "필드 없음/판정 불가"를 뜻함(만료됨과 다름) — v1 동일.
pub struct ClaudeOAuthSnapshot {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<f64>, // epoch ms
}

pub struct ClaudeCredentialsFile {
    pub raw: Value, // 원본 JSON 전체(구조 보존 쓰기용, 미지 필드 포함)
    pub oauth: ClaudeOAuthSnapshot,
}

/// 파일을 매번 새로 읽는다. 파일 없음/파싱 실패 → None (panic 금지).
pub fn read_claude_credentials(cred_path: &Path) -> Option<ClaudeCredentialsFile> {
    let text = fs::read_to_string(cred_path).ok()?;
    let raw: Value = serde_json::from_str(&text).ok()?;
    let oauth_raw = &raw["claudeAiOauth"];
    let access_token = oauth_raw["accessToken"]
        .as_str()
        .or_else(|| raw["accessToken"].as_str()) // v1: 톱레벨 accessToken 폴백
        .map(String::from);
    let refresh_token = oauth_raw["refreshToken"].as_str().map(String::from);
    let expires_at = oauth_raw["expiresAt"].as_f64();
    Some(ClaudeCredentialsFile {
        raw,
        oauth: ClaudeOAuthSnapshot { access_token, refresh_token, expires_at },
    })
}

/// claudeAiOauth.accessToken/refreshToken/expiresAt만 갱신하고 나머지 구조(키 순서 포함 —
/// preserve_order)는 보존해 원자적으로(같은 디렉터리 temp + rename) 쓴다.
/// refresh_token=None이면 기존 값 유지(비회전). expiresAt은 v1처럼 정수 ms(설계 D5).
/// 실패는 Err(()) — 오류 내용을 나르지 않는다(호출자는 v1 catch와 동일하게 버린다).
pub fn write_claude_oauth_update(
    cred_path: &Path,
    raw: &Value,
    access_token: &str,
    refresh_token: Option<&str>,
    expires_at_ms: i64,
) -> Result<(), ()> {
    let mut clone = raw.clone();
    let obj = clone.as_object_mut().ok_or(())?;
    let oauth = obj
        .entry("claudeAiOauth")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let oauth_obj = oauth.as_object_mut().ok_or(())?;
    oauth_obj.insert("accessToken".into(), Value::String(access_token.to_string()));
    if let Some(rt) = refresh_token {
        oauth_obj.insert("refreshToken".into(), Value::String(rt.to_string()));
    }
    oauth_obj.insert("expiresAt".into(), Value::from(expires_at_ms));
    let text = serde_json::to_string(&clone).map_err(|_| ())?;

    let dir = cred_path.parent().ok_or(())?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| ())?
        .as_nanos();
    let tmp = dir.join(format!(".{}-{}.tmp", std::process::id(), nanos));
    fs::write(&tmp, &text).map_err(|_| ())?;
    fs::rename(&tmp, cred_path).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    // 픽스처는 전부 FAKE 토큰 — 실계정 파일(~/.claude*) 접근 금지, temp 디렉터리만.
    fn fixture_text() -> &'static str {
        // 키 순서·미지 필드·한글 값 보존 검증용 — accessToken을 의도적으로 중간에 배치
        r#"{"unrelatedBefore":{"keep":"me","korean":"한글 값도 보존"},"claudeAiOauth":{"scopes":["user:inference"],"accessToken":"FAKE-ACCESS-OLD","refreshToken":"FAKE-REFRESH-OLD","expiresAt":1000,"subscriptionType":"max"},"unrelatedAfter":7}"#
    }

    fn write_fixture(dir: &Path) -> PathBuf {
        let p = dir.join(".credentials.json");
        fs::write(&p, fixture_text()).unwrap();
        p
    }

    #[test]
    fn reads_oauth_fields() {
        let dir = tempfile::tempdir().unwrap();
        let p = write_fixture(dir.path());
        let f = read_claude_credentials(&p).unwrap();
        assert_eq!(f.oauth.access_token.as_deref(), Some("FAKE-ACCESS-OLD"));
        assert_eq!(f.oauth.refresh_token.as_deref(), Some("FAKE-REFRESH-OLD"));
        assert_eq!(f.oauth.expires_at, Some(1000.0));
    }

    #[test]
    fn falls_back_to_top_level_access_token() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c.json");
        fs::write(&p, r#"{"accessToken":"FAKE-TOP"}"#).unwrap();
        let f = read_claude_credentials(&p).unwrap();
        assert_eq!(f.oauth.access_token.as_deref(), Some("FAKE-TOP"));
        assert_eq!(f.oauth.refresh_token, None);
        assert_eq!(f.oauth.expires_at, None); // 필드 없음 = 판정 불가(만료 아님)
    }

    #[test]
    fn missing_file_or_bad_json_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_claude_credentials(&dir.path().join("no.json")).is_none());
        let p = dir.path().join("bad.json");
        fs::write(&p, "not-json").unwrap();
        assert!(read_claude_credentials(&p).is_none());
    }

    #[test]
    fn write_rotation_preserves_structure_key_order_and_leaves_no_tmp() {
        let dir = tempfile::tempdir().unwrap();
        let p = write_fixture(dir.path());
        let f = read_claude_credentials(&p).unwrap();
        write_claude_oauth_update(&p, &f.raw, "FAKE-ACCESS-NEW", Some("FAKE-REFRESH-NEW"), 2000)
            .unwrap();
        // 키 순서까지 바이트 단위로 보존 (accessToken 등은 제자리 갱신, 값만 교체)
        let expected = r#"{"unrelatedBefore":{"keep":"me","korean":"한글 값도 보존"},"claudeAiOauth":{"scopes":["user:inference"],"accessToken":"FAKE-ACCESS-NEW","refreshToken":"FAKE-REFRESH-NEW","expiresAt":2000,"subscriptionType":"max"},"unrelatedAfter":7}"#;
        assert_eq!(fs::read_to_string(&p).unwrap(), expected);
        // 원자 쓰기: temp 파일 잔재가 없어야 함
        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![".credentials.json".to_string()]);
    }

    #[test]
    fn write_without_rotation_keeps_existing_refresh_token() {
        let dir = tempfile::tempdir().unwrap();
        let p = write_fixture(dir.path());
        let f = read_claude_credentials(&p).unwrap();
        write_claude_oauth_update(&p, &f.raw, "FAKE-ACCESS-NEW", None, 2000).unwrap();
        let updated = read_claude_credentials(&p).unwrap();
        assert_eq!(updated.oauth.access_token.as_deref(), Some("FAKE-ACCESS-NEW"));
        assert_eq!(updated.oauth.refresh_token.as_deref(), Some("FAKE-REFRESH-OLD"));
        assert_eq!(updated.oauth.expires_at, Some(2000.0));
    }

    #[test]
    fn write_creates_oauth_object_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c.json");
        fs::write(&p, r#"{"other":1}"#).unwrap();
        let f = read_claude_credentials(&p).unwrap();
        write_claude_oauth_update(&p, &f.raw, "FAKE-A", None, 5).unwrap();
        let updated = read_claude_credentials(&p).unwrap();
        assert_eq!(updated.oauth.access_token.as_deref(), Some("FAKE-A"));
        assert_eq!(updated.raw["other"], 1);
    }
}
