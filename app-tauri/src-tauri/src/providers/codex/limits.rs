// 코덱스 rollout 폴백 리더 — v1 providers/codex/limits.ts 이식. wham API 실패 시 폴러가 사용(4단계).
// ~/.codex/sessions 아래 최신 mtime의 rollout-*.jsonl 끝 TAIL_BYTES에서 마지막 rate_limits 이벤트를 읽는다.
use crate::providers::types::{RateError, RateStatus, RateWindow};
use serde_json::Value;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const TAIL_BYTES: u64 = 512 * 1024; // 42MB짜리 rollout도 끝부분만 읽는다
const STALE_MS: f64 = 30.0 * 60_000.0;

pub fn default_codex_sessions_dir() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").expect("USERPROFILE 없음"))
        .join(".codex")
        .join("sessions")
}

fn mtime_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn walk(dir: &Path, best: &mut Option<(PathBuf, f64)>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, best);
        } else if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            if name.starts_with("rollout-") && name.ends_with(".jsonl") {
                let Ok(meta) = fs::metadata(&p) else { continue };
                let m = mtime_ms(&meta);
                if best.as_ref().map_or(true, |(_, b)| m > *b) {
                    *best = Some((p, m));
                }
            }
        }
    }
}

fn newest_rollout(root: &Path) -> Option<(PathBuf, f64)> {
    let mut best = None;
    walk(root, &mut best);
    best
}

fn read_tail(path: &Path) -> std::io::Result<String> {
    let mut f = fs::File::open(path)?;
    let size = f.metadata()?.len();
    let start = size.saturating_sub(TAIL_BYTES);
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((size - start) as usize);
    f.read_to_end(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned()) // v1 toString('utf-8')과 동일한 관용 처리
}

fn window_kind(minutes: &Value) -> Option<&'static str> {
    match minutes.as_f64() {
        Some(m) if m == 300.0 => Some("session_5h"),
        Some(m) if m == 10080.0 => Some("weekly"),
        _ => None,
    }
}

fn windows_from(rl: &Value) -> Vec<RateWindow> {
    let mut out = vec![];
    for raw in [&rl["primary"], &rl["secondary"]] {
        let Some(used) = raw["used_percent"].as_f64() else { continue };
        let Some(kind) = window_kind(&raw["window_minutes"]) else { continue };
        out.push(RateWindow {
            kind: kind.to_string(),
            used_percent: used,
            resets_at: raw["resets_at"].as_f64().unwrap_or(0.0),
        });
    }
    // 표시 순서 고정: 세션 → 주간 (primary/secondary 배치와 무관하게)
    out.sort_by_key(|w| if w.kind == "session_5h" { 0 } else { 1 });
    out
}

/// v1 readCodexLimits. stale = 파일 mtime이 30분 이상 과거. fetched_at = 파일 mtime(epoch ms).
/// 파일 I/O 오류는 no-data로 변환한다(설계 D7 — v1은 폴러 catch로 새는 예외였음).
/// 주의(v1 quirk 유지): rate_limits 이벤트는 있었지만 창이 전부 미지 window_minutes로 떨어져도
/// error 없이 windows=[]로 반환한다.
pub fn read_codex_limits(sessions_dir: &Path, now_ms: f64) -> RateStatus {
    let base = RateStatus::base("codex", now_ms);
    let Some((path, file_mtime)) = newest_rollout(sessions_dir) else {
        return RateStatus { error: Some(RateError::NoCredentials), ..base };
    };
    let text = match read_tail(&path) {
        Ok(t) => t,
        Err(_) => {
            return RateStatus { fetched_at: file_mtime, error: Some(RateError::NoData), ..base }
        }
    };

    let mut last_rate_limits: Option<Value> = None;
    for line in text.split('\n') {
        if !line.contains("\"rate_limits\"") {
            continue;
        }
        let Some(brace_idx) = line.find('{') else { continue };
        let Ok(obj) = serde_json::from_str::<Value>(&line[brace_idx..]) else {
            continue; // tail 경계에서 잘린 첫 줄 등 — 무시
        };
        let rl = if !obj["payload"]["rate_limits"].is_null() {
            &obj["payload"]["rate_limits"]
        } else {
            &obj["rate_limits"]
        };
        if !rl.is_null() {
            last_rate_limits = Some(rl.clone());
        }
    }
    let Some(rl) = last_rate_limits else {
        return RateStatus { fetched_at: file_mtime, error: Some(RateError::NoData), ..base };
    };

    let plan = rl["plan_type"].as_str().map(String::from);
    RateStatus {
        windows: windows_from(&rl),
        plan,
        fetched_at: file_mtime,
        stale: Some(now_ms - file_mtime > STALE_MS),
        ..base
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{set_file_mtime, FileTime};

    const NOW: f64 = 1_800_000_000_000.0;

    fn write_rollout(dir: &Path, name: &str, lines: &[&str], mtime_secs: i64) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, lines.join("\n")).unwrap();
        set_file_mtime(&p, FileTime::from_unix_time(mtime_secs, 0)).unwrap();
        p
    }

    const RL_LINE_A: &str = r#"{"timestamp":"t","payload":{"type":"event","rate_limits":{"primary":{"used_percent":10,"window_minutes":300,"resets_at":111},"secondary":{"used_percent":20,"window_minutes":10080,"resets_at":222},"plan_type":"plus"}}}"#;
    const RL_LINE_B: &str = r#"{"rate_limits":{"primary":{"used_percent":33,"window_minutes":300,"resets_at":333}}}"#;

    #[test]
    fn no_rollout_files_is_no_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let s = read_codex_limits(dir.path(), NOW);
        assert_eq!(s.error, Some(RateError::NoCredentials));
        // 존재하지 않는 디렉터리도 동일
        let s2 = read_codex_limits(&dir.path().join("nope"), NOW);
        assert_eq!(s2.error, Some(RateError::NoCredentials));
    }

    #[test]
    fn non_rollout_filenames_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        write_rollout(dir.path(), "other.jsonl", &[RL_LINE_A], 1_700_000_000);
        write_rollout(dir.path(), "rollout-x.txt", &[RL_LINE_A], 1_700_000_000);
        assert_eq!(read_codex_limits(dir.path(), NOW).error, Some(RateError::NoCredentials));
    }

    #[test]
    fn picks_newest_mtime_across_subdirectories() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("2026").join("07");
        fs::create_dir_all(&sub).unwrap();
        write_rollout(dir.path(), "rollout-old.jsonl", &[RL_LINE_B], 1_700_000_000);
        write_rollout(&sub, "rollout-new.jsonl", &[RL_LINE_A], 1_800_000_000 - 60);
        let s = read_codex_limits(dir.path(), NOW);
        // 최신 파일(A)의 값: session 10%, weekly 20%, plan plus
        assert_eq!(s.windows.len(), 2);
        assert_eq!(s.windows[0].used_percent, 10.0);
        assert_eq!(s.plan.as_deref(), Some("plus"));
        assert_eq!(s.fetched_at, (1_800_000_000.0 - 60.0) * 1000.0);
        assert_eq!(s.stale, Some(false));
    }

    #[test]
    fn last_rate_limits_line_wins_and_supports_both_shapes() {
        let dir = tempfile::tempdir().unwrap();
        // payload 중첩(A) 뒤에 톱레벨(B) — 마지막 것이 이긴다
        write_rollout(dir.path(), "rollout-a.jsonl", &[RL_LINE_A, "{\"other\":1}", RL_LINE_B], 1_700_000_000);
        let s = read_codex_limits(dir.path(), NOW);
        assert_eq!(s.windows.len(), 1);
        assert_eq!(s.windows[0].used_percent, 33.0);
        assert_eq!(s.windows[0].resets_at, 333.0);
    }

    #[test]
    fn truncated_or_garbage_lines_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        // tail 경계에서 앞부분이 잘린 줄 재현: "rate_limits" 마커와 '{'는 있지만 JSON으로는 불완전
        let garbage = r#"ate_limits":{"x":1}} cut-off line containing "rate_limits" marker"#;
        write_rollout(dir.path(), "rollout-a.jsonl", &[garbage, RL_LINE_B], 1_700_000_000);
        let s = read_codex_limits(dir.path(), NOW);
        assert_eq!(s.windows[0].used_percent, 33.0); // 잘린 줄 무시, 유효 줄 채택
    }

    #[test]
    fn unknown_window_minutes_dropped_empty_windows_without_error() {
        let dir = tempfile::tempdir().unwrap();
        let line = r#"{"rate_limits":{"primary":{"used_percent":1,"window_minutes":60}}}"#;
        write_rollout(dir.path(), "rollout-a.jsonl", &[line], 1_700_000_000);
        let s = read_codex_limits(dir.path(), NOW);
        assert!(s.windows.is_empty());
        assert_eq!(s.error, None); // v1 quirk: rollout 경로엔 windows-empty→no-data 규칙이 없다
    }

    #[test]
    fn secondary_session_sorts_before_primary_weekly() {
        let dir = tempfile::tempdir().unwrap();
        let line = r#"{"rate_limits":{"primary":{"used_percent":5,"window_minutes":10080},"secondary":{"used_percent":6,"window_minutes":300}}}"#;
        write_rollout(dir.path(), "rollout-a.jsonl", &[line], 1_700_000_000);
        let s = read_codex_limits(dir.path(), NOW);
        assert_eq!(s.windows[0].kind, "session_5h");
        assert_eq!(s.windows[0].resets_at, 0.0); // resets_at 결측 → 0
    }

    #[test]
    fn no_rate_limits_lines_is_no_data_with_mtime_fetched_at() {
        let dir = tempfile::tempdir().unwrap();
        write_rollout(dir.path(), "rollout-a.jsonl", &["{\"other\":1}"], 1_700_000_000);
        let s = read_codex_limits(dir.path(), NOW);
        assert_eq!(s.error, Some(RateError::NoData));
        assert_eq!(s.fetched_at, 1_700_000_000_000.0);
    }

    #[test]
    fn stale_when_mtime_older_than_30min() {
        let dir = tempfile::tempdir().unwrap();
        let old_secs = ((NOW - 31.0 * 60_000.0) / 1000.0) as i64;
        write_rollout(dir.path(), "rollout-a.jsonl", &[RL_LINE_B], old_secs);
        assert_eq!(read_codex_limits(dir.path(), NOW).stale, Some(true));
        let fresh_secs = ((NOW - 60_000.0) / 1000.0) as i64;
        write_rollout(dir.path(), "rollout-b.jsonl", &[RL_LINE_B], fresh_secs);
        assert_eq!(read_codex_limits(dir.path(), NOW).stale, Some(false));
    }

    #[test]
    fn only_tail_bytes_are_read() {
        let dir = tempfile::tempdir().unwrap();
        // 유일한 rate_limits 줄을 파일 머리에 두고, TAIL_BYTES를 넘는 필러 뒤에 배치 — tail만 읽으면 no-data
        let filler = "x".repeat(700 * 1024);
        write_rollout(dir.path(), "rollout-a.jsonl", &[RL_LINE_A, &filler], 1_700_000_000);
        let s = read_codex_limits(dir.path(), NOW);
        assert_eq!(s.error, Some(RateError::NoData));
    }
}
