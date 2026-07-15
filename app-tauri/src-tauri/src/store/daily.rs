// daily_usage 업서트 — v1 store/daily.ts 이식. PK(date, provider, model) 충돌 시 REPLACE.
use rusqlite::Connection;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyRow {
    pub date: String,
    pub provider: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_tokens: i64,
    pub cost_usd: f64,
}

pub fn upsert_daily(conn: &mut Connection, rows: &[DailyRow]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO daily_usage(date, provider, model, input_tokens, output_tokens, cache_tokens, cost_usd)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for r in rows {
            stmt.execute(rusqlite::params![
                r.date, r.provider, r.model, r.input_tokens, r.output_tokens, r.cache_tokens, r.cost_usd
            ])?;
        }
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_replaces_on_pk_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        let row = |cost: f64| DailyRow {
            date: "2026-07-15".into(), provider: "claude".into(), model: "opus".into(),
            input_tokens: 1, output_tokens: 2, cache_tokens: 3, cost_usd: cost,
        };
        upsert_daily(&mut conn, &[row(1.0)]).unwrap();
        upsert_daily(&mut conn, &[row(9.0)]).unwrap(); // 같은 PK → REPLACE
        let (n, cost): (i64, f64) = conn
            .query_row("SELECT COUNT(*), MAX(cost_usd) FROM daily_usage", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!(cost, 9.0);
    }
}
