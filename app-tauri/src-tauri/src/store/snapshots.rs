// rate_snapshots 기록 — v1 store/snapshots.ts 이식.
// (provider, window, account_id)별 직전 기록과 동일하면 행을 추가하지 않는다(dedup).
// v2 스키마(account_id 컬럼)와 v1 스키마(마이그레이션 실패 폴백) 모두 지원 — 컬럼 존재로 SQL 선택.
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateWindow {
    pub kind: String,
    pub used_percent: f64,
    pub resets_at: i64,
}

fn has_account_column(conn: &Connection) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare("PRAGMA table_info(rate_snapshots)")?;
    let names = stmt.query_map([], |r| r.get::<_, String>(1))?;
    let found = names.filter_map(Result::ok).any(|n| n == "account_id");
    Ok(found)
}

pub fn record_snapshots(
    conn: &mut Connection,
    provider: &str,
    fetched_at: i64,
    windows: &[RateWindow],
    account_id: &str,
) -> rusqlite::Result<()> {
    let v2 = has_account_column(conn)?;
    let tx = conn.transaction()?;
    {
        let mut select = tx.prepare(if v2 {
            "SELECT used_percent, resets_at FROM rate_snapshots
             WHERE provider = ?1 AND window = ?2 AND account_id = ?3 ORDER BY ts DESC LIMIT 1"
        } else {
            "SELECT used_percent, resets_at FROM rate_snapshots
             WHERE provider = ?1 AND window = ?2 ORDER BY ts DESC LIMIT 1"
        })?;
        let mut insert = tx.prepare(if v2 {
            "INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at, account_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
        } else {
            "INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at)
             VALUES (?1, ?2, ?3, ?4, ?5)"
        })?;
        for w in windows {
            let prev: Option<(f64, i64)> = if v2 {
                select
                    .query_row(rusqlite::params![provider, w.kind, account_id], |r| {
                        Ok((r.get(0)?, r.get(1)?))
                    })
                    .optional()?
            } else {
                select
                    .query_row(rusqlite::params![provider, w.kind], |r| {
                        Ok((r.get(0)?, r.get(1)?))
                    })
                    .optional()?
            };
            if let Some((p, r)) = prev {
                if p == w.used_percent && r == w.resets_at {
                    continue;
                }
            }
            if v2 {
                insert.execute(rusqlite::params![
                    fetched_at, provider, w.kind, w.used_percent, w.resets_at, account_id
                ])?;
            } else {
                insert.execute(rusqlite::params![
                    fetched_at, provider, w.kind, w.used_percent, w.resets_at
                ])?;
            }
        }
    }
    tx.commit()
}

/// 해당 계정의 창별 최신 스냅샷으로 RateStatus 유사 구조를 재구성한다. 행이 없으면 None.
/// SQLite의 bare-column + MAX(ts) 규칙: 그룹 내 MAX 행의 나머지 컬럼 값이 선택된다.
pub fn latest_account_snapshot(
    conn: &Connection,
    provider: &str,
    account_id: &str,
) -> rusqlite::Result<Option<Value>> {
    let mut stmt = conn.prepare(
        "SELECT window, used_percent, resets_at, MAX(ts) AS ts FROM rate_snapshots
         WHERE provider = ?1 AND account_id = ?2 GROUP BY window",
    )?;
    let rows: Vec<(String, f64, i64, i64)> = stmt
        .query_map(rusqlite::params![provider, account_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<Result<_, _>>()?;
    if rows.is_empty() {
        return Ok(None);
    }
    let fetched_at = rows.iter().map(|r| r.3).max().unwrap_or(0);
    let mut windows: Vec<&(String, f64, i64, i64)> = rows
        .iter()
        .filter(|r| r.0 == "session_5h" || r.0 == "weekly")
        .collect();
    windows.sort_by_key(|r| if r.0 == "session_5h" { 0 } else { 1 });
    let windows: Vec<Value> = windows
        .into_iter()
        .map(|(kind, used, resets, _)| {
            json!({ "kind": kind, "usedPercent": used, "resetsAt": resets })
        })
        .collect();
    Ok(Some(json!({ "windows": windows, "fetchedAt": fetched_at })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_dedups_unchanged_and_records_changed() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        assert!(crate::store::db::apply_multi_account_schema(&mut conn));
        let w = |p: f64| vec![RateWindow { kind: "session_5h".into(), used_percent: p, resets_at: 999 }];
        record_snapshots(&mut conn, "claude", 1000, &w(10.0), "acc-1").unwrap();
        record_snapshots(&mut conn, "claude", 2000, &w(10.0), "acc-1").unwrap(); // 동일 → skip
        record_snapshots(&mut conn, "claude", 3000, &w(20.0), "acc-1").unwrap(); // 변경 → 기록
        record_snapshots(&mut conn, "claude", 3000, &w(10.0), "acc-2").unwrap(); // 다른 계정 → 독립 dedup
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM rate_snapshots", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn record_works_on_v1_schema_without_account_column() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        // 마이그레이션 없이 v1 스키마 그대로 — account_id 없이 기록되어야 한다
        let w = vec![RateWindow { kind: "weekly".into(), used_percent: 5.0, resets_at: 999 }];
        record_snapshots(&mut conn, "codex", 1000, &w, "").unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM rate_snapshots", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn latest_account_snapshot_picks_max_ts_and_orders_windows() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        assert!(crate::store::db::apply_multi_account_schema(&mut conn));
        let mk = |kind: &str, p: f64| RateWindow { kind: kind.into(), used_percent: p, resets_at: 999 };
        record_snapshots(&mut conn, "claude", 1000, &[mk("weekly", 1.0)], "a").unwrap();
        record_snapshots(&mut conn, "claude", 2000, &[mk("weekly", 2.0), mk("session_5h", 9.0)], "a").unwrap();
        let snap = latest_account_snapshot(&conn, "claude", "a").unwrap().unwrap();
        assert_eq!(snap["fetchedAt"], 2000);
        let windows = snap["windows"].as_array().unwrap();
        assert_eq!(windows[0]["kind"], "session_5h"); // session_5h 먼저
        assert_eq!(windows[1]["usedPercent"], 2.0); // weekly는 최신값
        assert!(latest_account_snapshot(&conn, "claude", "none").unwrap().is_none());
    }
}
