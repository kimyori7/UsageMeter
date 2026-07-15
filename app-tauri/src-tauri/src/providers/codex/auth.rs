// ~/.codex/auth.json 리더 — v1 providers/codex/auth.ts 이식. 반환 토큰은 Rust 메모리에서만 사용 —
// 로그·IPC로 내보내지 말 것.
// 의도적으로 refresh_token은 읽지 않는다(스펙 F3: 1회용 회전식이라 외부 앱이 쓰면 CLI 로그인 파손).
use std::path::{Path, PathBuf};

pub fn default_codex_auth_path() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").expect("USERPROFILE 없음"))
        .join(".codex")
        .join("auth.json")
}

// Debug 미파생: 토큰 보유 구조체를 {:?}로 찍는 코드가 컴파일되지 않게 한다 (claude 쪽과 동일한 차단).
#[derive(Clone, PartialEq)]
pub struct CodexAuth {
    pub access_token: String,
    pub account_id: String,
}

/// 파일 없음/파싱 실패/필드 결측 → None (panic 금지).
pub fn read_codex_auth(auth_path: &Path) -> Option<CodexAuth> {
    let raw: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(auth_path).ok()?).ok()?;
    let tokens = &raw["tokens"];
    Some(CodexAuth {
        access_token: tokens["access_token"].as_str()?.to_string(),
        account_id: tokens["account_id"].as_str()?.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("auth.json");
        // 실물처럼 refresh_token이 존재하는 픽스처 — 하지만 CodexAuth에는 실리지 않아야 한다(스펙 F3)
        fs::write(
            &p,
            r#"{"tokens":{"access_token":"FAKE-AT","account_id":"acc-1","refresh_token":"FAKE-RT"},"last_refresh":"x"}"#,
        )
        .unwrap();
        let a = read_codex_auth(&p).unwrap();
        // 구조체 단위 assert_eq!는 Debug를 요구하므로 필드별로 비교한다
        assert_eq!(a.access_token, "FAKE-AT");
        assert_eq!(a.account_id, "acc-1");
    }

    #[test]
    fn missing_fields_or_file_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("auth.json");
        fs::write(&p, r#"{"tokens":{"access_token":"FAKE-AT"}}"#).unwrap();
        assert!(read_codex_auth(&p).is_none()); // account_id 결측
        fs::write(&p, "broken").unwrap();
        assert!(read_codex_auth(&p).is_none());
        assert!(read_codex_auth(&dir.path().join("no.json")).is_none());
    }
}
