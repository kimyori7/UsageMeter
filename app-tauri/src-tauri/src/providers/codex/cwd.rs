// codex ccusage 세션 행의 directory는 ~/.codex/sessions 밑 날짜 폴더(예: 2026/07/13)일 뿐
// 실제 cwd가 아니다. 진짜 cwd는 해당 rollout 파일 첫 줄 JSON(session_meta 이벤트) payload.cwd에
// 있다 — v1 providers/codex/cwd.ts 이식. ccusage가 주는 sessionFile은 확장자 없는 베이스네임이라
// .jsonl 재시도가 필요하다. 결과는 (directory, sessionFile)별로 캐시한다(부재 포함 — v1 Map 동일).
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

pub struct CwdResolver {
    sessions_root: PathBuf,
    cache: RefCell<HashMap<String, Option<String>>>,
}

impl CwdResolver {
    pub fn new(sessions_root: PathBuf) -> Self {
        Self { sessions_root, cache: RefCell::new(HashMap::new()) }
    }

    pub fn resolve(&self, directory: &str, session_file: &str) -> Option<String> {
        let key = format!("{directory}/{session_file}");
        if let Some(cached) = self.cache.borrow().get(&key) {
            return cached.clone();
        }
        let cwd = read_cwd(&self.sessions_root, directory, session_file);
        self.cache.borrow_mut().insert(key, cwd.clone());
        cwd
    }
}

/// 첫 줄만 읽는다 — rollout 파일은 수 MB일 수 있다(v1은 전체를 읽고 첫 줄만 썼음 — 결과 동일).
fn first_line(path: &Path) -> Option<String> {
    let f = std::fs::File::open(path).ok()?;
    let mut line = String::new();
    BufReader::new(f).read_line(&mut line).ok()?;
    Some(line)
}

fn read_cwd(root: &Path, directory: &str, session_file: &str) -> Option<String> {
    let base = root.join(directory).join(session_file);
    // v1은 문자열 연결(base + '.jsonl')이었다 — with_extension은 마지막 점 뒤를 치환해 버리므로
    // OsString append로 동일 의미를 유지한다.
    let mut with_ext = base.as_os_str().to_os_string();
    with_ext.push(".jsonl");
    let line = first_line(&base).or_else(|| first_line(Path::new(&with_ext)))?;
    let meta: Value = serde_json::from_str(&line).ok()?;
    // v1: meta.payload?.cwd ?? meta.cwd — payload.cwd가 존재하되 문자열이 아니면(널 제외)
    // 톱레벨로 폴백하지 않고 None (?? 는 null/undefined에서만 폴백).
    let candidate =
        if meta["payload"]["cwd"].is_null() { &meta["cwd"] } else { &meta["payload"]["cwd"] };
    candidate.as_str().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_rollout(root: &Path, dir: &str, name: &str, first_line: &str) {
        let d = root.join(dir);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join(name), format!("{first_line}\n{{\"other\":\"line\"}}\n")).unwrap();
    }

    #[test]
    fn resolves_payload_cwd_with_jsonl_retry() {
        let tmp = tempfile::tempdir().unwrap();
        // sessionFile은 확장자 없이 오지만 실파일은 .jsonl — 재시도 경로가 정상 경로다
        write_rollout(
            tmp.path(),
            "2026/07/15",
            "rollout-a.jsonl",
            r#"{"type":"session_meta","payload":{"cwd":"D:\\proj\\alpha"}}"#,
        );
        let r = CwdResolver::new(tmp.path().to_path_buf());
        assert_eq!(r.resolve("2026/07/15", "rollout-a").as_deref(), Some("D:\\proj\\alpha"));
    }

    #[test]
    fn jsonl_retry_appends_even_when_name_contains_dots() {
        let tmp = tempfile::tempdir().unwrap();
        // 회귀 가드: with_extension이면 마지막 점 뒤가 치환돼(sess.2026.jsonl) 못 찾는다 —
        // 문자열 append만 sess.2026.07.jsonl에 도달한다
        write_rollout(
            tmp.path(),
            "2026/07/15",
            "sess.2026.07.jsonl",
            r#"{"payload":{"cwd":"D:\\proj\\dotted"}}"#,
        );
        let r = CwdResolver::new(tmp.path().to_path_buf());
        assert_eq!(r.resolve("2026/07/15", "sess.2026.07").as_deref(), Some("D:\\proj\\dotted"));
    }

    #[test]
    fn resolves_exact_path_and_top_level_cwd_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        // 확장자 포함 정확 경로 + payload 없이 톱레벨 cwd만 있는 구형 포맷
        write_rollout(tmp.path(), "2026/07/14", "rollout-b", r#"{"cwd":"D:\\proj\\beta"}"#);
        let r = CwdResolver::new(tmp.path().to_path_buf());
        assert_eq!(r.resolve("2026/07/14", "rollout-b").as_deref(), Some("D:\\proj\\beta"));
    }

    #[test]
    fn non_string_payload_cwd_does_not_fall_back() {
        let tmp = tempfile::tempdir().unwrap();
        // v1 ?? 의미론: payload.cwd가 널이 아닌 비문자열이면 톱레벨 cwd로 폴백하지 않는다
        write_rollout(
            tmp.path(),
            "2026/07/13",
            "rollout-c.jsonl",
            r#"{"payload":{"cwd":123},"cwd":"D:\\ignored"}"#,
        );
        let r = CwdResolver::new(tmp.path().to_path_buf());
        assert_eq!(r.resolve("2026/07/13", "rollout-c"), None);
    }

    #[test]
    fn missing_file_or_broken_json_is_none() {
        let tmp = tempfile::tempdir().unwrap();
        write_rollout(tmp.path(), "2026/07/12", "rollout-d.jsonl", "not json at all");
        let r = CwdResolver::new(tmp.path().to_path_buf());
        assert_eq!(r.resolve("2026/07/12", "rollout-d"), None); // 첫 줄이 JSON 아님
        assert_eq!(r.resolve("2026/07/12", "no-such-file"), None); // 파일 없음
    }

    #[test]
    fn caches_negative_result() {
        let tmp = tempfile::tempdir().unwrap();
        let r = CwdResolver::new(tmp.path().to_path_buf());
        assert_eq!(r.resolve("2026/07/11", "rollout-e"), None); // miss → None 캐시
        // 이후 파일이 생겨도 캐시가 이긴다 (v1 Map 캐시 동일 — 재시작까지 유지)
        write_rollout(tmp.path(), "2026/07/11", "rollout-e.jsonl", r#"{"payload":{"cwd":"D:\\late"}}"#);
        assert_eq!(r.resolve("2026/07/11", "rollout-e"), None);
    }
}
