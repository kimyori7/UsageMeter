// 현재 로그인된 클로드 계정 신원 — v1 providers/claude/account.ts 이식 (스펙 F1).
// ~/.claude.json은 수 MB일 수 있으나 폴링 주기 1회 읽기라 허용.
use std::path::{Path, PathBuf};

pub fn default_claude_config_path() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").expect("USERPROFILE 없음")).join(".claude.json")
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaudeAccountIdentity {
    pub id: String,
    pub email: String,
}

/// oauthAccount.accountUuid가 없으면(로그아웃 등) None. 파일 없음/파싱 실패도 None (panic 금지).
pub fn read_claude_account(config_path: &Path) -> Option<ClaudeAccountIdentity> {
    let raw: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(config_path).ok()?).ok()?;
    let acc = &raw["oauthAccount"];
    let id = acc["accountUuid"].as_str()?;
    if id.is_empty() {
        return None;
    }
    Some(ClaudeAccountIdentity {
        id: id.to_string(),
        email: acc["emailAddress"].as_str().unwrap_or("").to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(dir: &Path, text: &str) -> PathBuf {
        let p = dir.join(".claude.json");
        fs::write(&p, text).unwrap();
        p
    }

    #[test]
    fn reads_identity() {
        let dir = tempfile::tempdir().unwrap();
        let p = write(
            dir.path(),
            r#"{"oauthAccount":{"accountUuid":"uuid-1","emailAddress":"a@b.com"},"junk":1}"#,
        );
        assert_eq!(
            read_claude_account(&p),
            Some(ClaudeAccountIdentity { id: "uuid-1".into(), email: "a@b.com".into() })
        );
    }

    #[test]
    fn missing_or_empty_uuid_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let p1 = write(dir.path(), r#"{"oauthAccount":{"emailAddress":"a@b.com"}}"#);
        assert!(read_claude_account(&p1).is_none());
        let p2 = write(dir.path(), r#"{"oauthAccount":{"accountUuid":""}}"#);
        assert!(read_claude_account(&p2).is_none());
        assert!(read_claude_account(&dir.path().join("nope.json")).is_none());
    }

    #[test]
    fn missing_email_becomes_empty_string() {
        let dir = tempfile::tempdir().unwrap();
        let p = write(dir.path(), r#"{"oauthAccount":{"accountUuid":"uuid-2"}}"#);
        assert_eq!(read_claude_account(&p).unwrap().email, "");
    }
}
