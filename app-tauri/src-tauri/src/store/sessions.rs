// session_usage 업서트 — v1 store/sessions.ts 이식. PK(session_id) 충돌 시 REPLACE.
use rusqlite::Connection;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub session_id: String,
    pub provider: String,
    pub folder: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub total_tokens: i64,
    pub cost_usd: f64,
    /// 세션에서 사용된 모델명을 ", "로 이은 문자열 — 미상이면 빈 문자열(daily의 codex 표기와 동일 규칙).
    #[serde(default)]
    pub models: String,
}

pub fn upsert_sessions(conn: &mut Connection, rows: &[SessionRow]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO session_usage(session_id, provider, folder, started_at, ended_at, total_tokens, cost_usd, models)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for r in rows {
            stmt.execute(rusqlite::params![
                r.session_id, r.provider, r.folder, r.started_at, r.ended_at, r.total_tokens,
                r.cost_usd, r.models
            ])?;
        }
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_db(dir: &tempfile::TempDir) -> Connection {
        let conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        assert!(crate::store::db::apply_session_models_schema(&conn));
        conn
    }

    #[test]
    fn upsert_sessions_replaces_and_keeps_null_started_at() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = migrated_db(&dir);
        let row = SessionRow {
            session_id: "s1".into(), provider: "codex".into(), folder: "D:/p".into(),
            started_at: None, ended_at: Some("2026-07-15T01:00:00Z".into()),
            total_tokens: 10, cost_usd: 0.1, models: "gpt-5.6-sol".into(),
        };
        upsert_sessions(&mut conn, &[row]).unwrap();
        let started: Option<String> = conn
            .query_row("SELECT started_at FROM session_usage WHERE session_id='s1'", [], |r| r.get(0))
            .unwrap();
        assert!(started.is_none());
    }

    #[test]
    fn upsert_overwrites_models_on_replace() {
        // 재폴링 시 ccusage가 전체 이력을 다시 내려주므로 REPLACE로 과거 세션의 models가 채워진다.
        let dir = tempfile::tempdir().unwrap();
        let mut conn = migrated_db(&dir);
        let base = |models: &str| SessionRow {
            session_id: "s1".into(), provider: "claude".into(), folder: "D:/p".into(),
            started_at: None, ended_at: None, total_tokens: 10, cost_usd: 0.1,
            models: models.into(),
        };
        upsert_sessions(&mut conn, &[base("")]).unwrap();
        upsert_sessions(&mut conn, &[base("claude-haiku-4-5-20251001")]).unwrap();
        let models: String = conn
            .query_row("SELECT models FROM session_usage WHERE session_id='s1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(models, "claude-haiku-4-5-20251001");
    }
}
