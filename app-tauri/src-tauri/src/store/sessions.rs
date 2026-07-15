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
}

pub fn upsert_sessions(conn: &mut Connection, rows: &[SessionRow]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO session_usage(session_id, provider, folder, started_at, ended_at, total_tokens, cost_usd)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for r in rows {
            stmt.execute(rusqlite::params![
                r.session_id, r.provider, r.folder, r.started_at, r.ended_at, r.total_tokens, r.cost_usd
            ])?;
        }
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_sessions_replaces_and_keeps_null_started_at() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        let row = SessionRow {
            session_id: "s1".into(), provider: "codex".into(), folder: "D:/p".into(),
            started_at: None, ended_at: Some("2026-07-15T01:00:00Z".into()),
            total_tokens: 10, cost_usd: 0.1,
        };
        upsert_sessions(&mut conn, &[row]).unwrap();
        let started: Option<String> = conn
            .query_row("SELECT started_at FROM session_usage WHERE session_id='s1'", [], |r| r.get(0))
            .unwrap();
        assert!(started.is_none());
    }
}
