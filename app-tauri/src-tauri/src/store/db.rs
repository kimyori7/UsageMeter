// SQLite 연결 + 스키마 생성 (idempotent, CREATE TABLE/INDEX IF NOT EXISTS).
// v1 app/src/store/db.ts의 1:1 이식 — 스키마 문자열은 문자 그대로 동일하게 유지한다.
use rusqlite::Connection;
use std::path::Path;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS daily_usage(
  date TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cache_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL,
  PRIMARY KEY(date, provider, model));
CREATE TABLE IF NOT EXISTS session_usage(
  session_id TEXT PRIMARY KEY, provider TEXT NOT NULL, folder TEXT NOT NULL,
  started_at TEXT, ended_at TEXT, total_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL);
CREATE TABLE IF NOT EXISTS rate_snapshots(
  ts INTEGER NOT NULL, provider TEXT NOT NULL, window TEXT NOT NULL,
  used_percent REAL NOT NULL, resets_at INTEGER NOT NULL,
  PRIMARY KEY(ts, provider, window));
CREATE INDEX IF NOT EXISTS idx_session_folder ON session_usage(folder);
";

pub fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // v1/v2 동시 기동(과도기)이나 폴러 틱과의 짧은 잠금 경합을 기다린다.
    conn.busy_timeout(std::time::Duration::from_millis(5000))?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

/// 멀티 계정 스키마 v2 — v1 db.ts applyMultiAccountSchema의 이식. 단일 트랜잭션,
/// 실패 시 원상 롤백 + false (호출자는 멀티 계정 기능만 끄고 계속 — 데이터 파괴 금지).
/// rate_snapshots는 PK에 account_id를 넣기 위해 재생성. 계정 미상은 NULL이 아닌 ''(PK 참여).
pub fn apply_multi_account_schema(conn: &mut Connection) -> bool {
    let result: rusqlite::Result<()> = (|| {
        let tx = conn.transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS accounts(
               provider TEXT NOT NULL, id TEXT NOT NULL,
               email TEXT NOT NULL DEFAULT '', plan TEXT,
               first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
               PRIMARY KEY(provider, id));
             CREATE TABLE IF NOT EXISTS login_periods(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               provider TEXT NOT NULL, account_id TEXT NOT NULL,
               started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL);
             CREATE INDEX IF NOT EXISTS idx_login_periods_provider ON login_periods(provider, ended_at);",
        )?;
        let has_account_id = {
            let mut stmt = tx.prepare("PRAGMA table_info(rate_snapshots)")?;
            let names = stmt.query_map([], |r| r.get::<_, String>(1))?;
            let found = names.filter_map(Result::ok).any(|n| n == "account_id");
            found
        };
        if !has_account_id {
            tx.execute_batch(
                "CREATE TABLE rate_snapshots_v2(
                   ts INTEGER NOT NULL, provider TEXT NOT NULL, window TEXT NOT NULL,
                   used_percent REAL NOT NULL, resets_at INTEGER NOT NULL,
                   account_id TEXT NOT NULL DEFAULT '',
                   PRIMARY KEY(ts, provider, window, account_id));
                 INSERT INTO rate_snapshots_v2(ts, provider, window, used_percent, resets_at, account_id)
                   SELECT ts, provider, window, used_percent, resets_at, '' FROM rate_snapshots;
                 DROP TABLE rate_snapshots;
                 ALTER TABLE rate_snapshots_v2 RENAME TO rate_snapshots;",
            )?;
        }
        tx.commit()?;
        Ok(())
    })();
    result.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db_path(dir: &tempfile::TempDir) -> std::path::PathBuf {
        dir.path().join("usage.db")
    }

    #[test]
    fn creates_schema_tables() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&temp_db_path(&dir)).unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for t in ["daily_usage", "rate_snapshots", "session_usage"] {
            assert!(names.iter().any(|n| n == t), "missing table {t}");
        }
    }

    #[test]
    fn reopen_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_db_path(&dir);
        {
            let conn = open_db(&path).unwrap();
            conn.execute(
                "INSERT INTO daily_usage VALUES ('2026-07-15','claude','opus',1,2,3,0.5)",
                [],
            )
            .unwrap();
        }
        let conn = open_db(&path).unwrap(); // 스키마 재실행이 기존 데이터를 건드리면 안 된다
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM daily_usage", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn migration_adds_account_id_and_preserves_rows() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = open_db(&temp_db_path(&dir)).unwrap();
        conn.execute(
            "INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at)
             VALUES (1000, 'claude', 'session_5h', 42.0, 2000)",
            [],
        )
        .unwrap();
        assert!(apply_multi_account_schema(&mut conn));
        // 기존 행 보존 + account_id='' 부여
        let (used, acc): (f64, String) = conn
            .query_row(
                "SELECT used_percent, account_id FROM rate_snapshots WHERE ts = 1000",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(used, 42.0);
        assert_eq!(acc, "");
        // accounts / login_periods 생성
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('accounts','login_periods')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn migration_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = open_db(&temp_db_path(&dir)).unwrap();
        assert!(apply_multi_account_schema(&mut conn));
        assert!(apply_multi_account_schema(&mut conn)); // 두 번째 호출도 true, 스키마 그대로
    }
}
