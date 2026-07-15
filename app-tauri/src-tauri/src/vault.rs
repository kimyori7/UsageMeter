// 토큰 사본 보관소 — v1 main/account-vault.ts 이식 (스펙 §데이터 호환 계약: accounts/<provider>-<sanitized-id>.json).
// 사본은 원본 자격증명 파일의 통째 복사 — 내용을 파싱·로깅하지 않는다.
// 코덱스 사본의 refresh_token은 어떤 코드도 읽지 않는다(스펙 F3). 모든 메서드는 절대 panic하지 않는다.
use std::fs;
use std::path::{Path, PathBuf};

pub struct Vault {
    root: PathBuf,
}

fn file_key(provider: &str, account_id: &str) -> String {
    let sanitized: String = account_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' })
        .collect();
    format!("{provider}-{sanitized}")
}

impl Vault {
    /// 루트 생성 실패여도 반환한다 — 이후 호출들이 개별적으로 조용히 실패한다(앱 부팅을 막지 않는다).
    pub fn new(root: PathBuf) -> Self {
        let _ = fs::create_dir_all(&root);
        Self { root }
    }

    pub fn cred_path(&self, provider: &str, account_id: &str) -> PathBuf {
        self.root.join(format!("{}.json", file_key(provider, account_id)))
    }

    fn revoked_path(&self, provider: &str, account_id: &str) -> PathBuf {
        self.root.join(format!("{}.revoked", file_key(provider, account_id)))
    }

    pub fn has_copy(&self, provider: &str, account_id: &str) -> bool {
        self.cred_path(provider, account_id).exists()
    }

    /// 원본과 사본이 다를 때만 temp+rename으로 교체. 새 사본 도착 = revoked 마커 해제.
    /// 원본 없음/쓰기 실패 → 기존 사본 유지(다음 틱에 재시도).
    pub fn copy_if_changed(&self, provider: &str, account_id: &str, source_path: &Path) {
        let Ok(source) = fs::read_to_string(source_path) else { return };
        let dest = self.cred_path(provider, account_id);
        if let Ok(existing) = fs::read_to_string(&dest) {
            if existing == source {
                return;
            }
        }
        let tmp = self
            .root
            .join(format!(".{}.{}.tmp", file_key(provider, account_id), std::process::id()));
        if fs::write(&tmp, &source).is_err() {
            return;
        }
        if fs::rename(&tmp, &dest).is_err() {
            let _ = fs::remove_file(&tmp); // v1은 잔재를 남기지만 청소가 엄밀히 우세(무해 편차)
            return;
        }
        let _ = fs::remove_file(self.revoked_path(provider, account_id));
    }

    pub fn is_revoked(&self, provider: &str, account_id: &str) -> bool {
        self.revoked_path(provider, account_id).exists()
    }

    /// 마킹 실패는 무시 — 다음 틱에 401을 다시 만나면 재시도 (v1 동일).
    pub fn mark_revoked(&self, provider: &str, account_id: &str) {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let _ = fs::write(self.revoked_path(provider, account_id), now_ms.to_string());
    }
}

#[cfg(test)]
mod tests {
    // 픽스처는 전부 FAKE 토큰 — 실계정 파일 접근 금지, temp 디렉터리만.
    use super::*;

    struct Fx {
        _root: tempfile::TempDir,
        vault_root: PathBuf,
        _src: tempfile::TempDir,
        src_path: PathBuf,
    }

    fn fx(content: &str) -> Fx {
        let root = tempfile::tempdir().unwrap();
        let vault_root = root.path().join("accounts");
        let src = tempfile::tempdir().unwrap();
        let src_path = src.path().join("auth.json");
        fs::write(&src_path, content).unwrap();
        Fx { vault_root, _root: root, src_path, _src: src }
    }

    #[test]
    fn copy_skip_identical_update_changed_no_tmp_residue() {
        let f = fx(r#"{"t":"FAKE-1"}"#);
        let vault = Vault::new(f.vault_root.clone());
        vault.copy_if_changed("codex", "acc-1", &f.src_path);
        assert!(vault.has_copy("codex", "acc-1"));
        assert_eq!(
            fs::read_to_string(vault.cred_path("codex", "acc-1")).unwrap(),
            r#"{"t":"FAKE-1"}"#
        );
        vault.copy_if_changed("codex", "acc-1", &f.src_path); // 동일 — 스킵(에러 없이)
        fs::write(&f.src_path, r#"{"t":"FAKE-2"}"#).unwrap();
        vault.copy_if_changed("codex", "acc-1", &f.src_path);
        assert_eq!(
            fs::read_to_string(vault.cred_path("codex", "acc-1")).unwrap(),
            r#"{"t":"FAKE-2"}"#
        );
        let leftovers: Vec<String> = fs::read_dir(&f.vault_root)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn revoked_persists_across_instances_and_clears_on_changed_copy() {
        let f = fx(r#"{"t":"FAKE-1"}"#);
        let vault = Vault::new(f.vault_root.clone());
        vault.copy_if_changed("claude", "acc-1", &f.src_path);
        vault.mark_revoked("claude", "acc-1");
        assert!(Vault::new(f.vault_root.clone()).is_revoked("claude", "acc-1")); // 영속
        fs::write(&f.src_path, r#"{"t":"FAKE-3"}"#).unwrap();
        vault.copy_if_changed("claude", "acc-1", &f.src_path); // 새 토큰 → 해제
        assert!(!vault.is_revoked("claude", "acc-1"));
    }

    #[test]
    fn missing_source_keeps_existing_copy_silently() {
        let f = fx(r#"{"t":"FAKE-1"}"#);
        let vault = Vault::new(f.vault_root.clone());
        vault.copy_if_changed("codex", "acc-1", &f.src_path);
        vault.copy_if_changed("codex", "acc-1", &f.src_path.with_file_name("no-such.json"));
        assert_eq!(
            fs::read_to_string(vault.cred_path("codex", "acc-1")).unwrap(),
            r#"{"t":"FAKE-1"}"#
        );
    }

    #[test]
    fn sanitizes_path_dangerous_chars_in_account_id() {
        let f = fx("{}");
        let vault = Vault::new(f.vault_root.clone());
        let p = vault.cred_path("claude", "a/b\\c:d");
        assert!(p.starts_with(&f.vault_root));
        // 전체 경로가 아닌 파일명만 검사 — Windows 경로 구분자('\')가 항상 앞에 붙으므로
        let name = p.file_name().unwrap().to_string_lossy();
        assert!(!name.contains('/'));
        assert!(!name.contains('\\'));
        assert!(!name.contains(':'));
        assert_eq!(name, "claude-a_b_c_d.json");
    }

    #[test]
    fn unwritable_root_does_not_panic() {
        // 존재할 수 없는 루트(파일을 루트 경로로 지정) — 모든 호출이 조용히 실패해야 한다
        let f = fx(r#"{"t":"FAKE-1"}"#);
        let file_as_root = f.src_path.clone(); // 파일 경로를 디렉터리 루트로
        let vault = Vault::new(file_as_root);
        vault.copy_if_changed("codex", "acc-1", &f.src_path);
        assert!(!vault.has_copy("codex", "acc-1"));
        vault.mark_revoked("codex", "acc-1");
        assert!(!vault.is_revoked("codex", "acc-1"));
    }
}
