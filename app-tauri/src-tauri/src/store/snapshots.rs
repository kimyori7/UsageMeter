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
            // v1(JS)이 소수부 있는 ms를 REAL로 저장한 행이 실DB에 존재 — resets_at을 i64 강타입으로
            // 읽으면 거부된다. f64로 읽고 신규 poll의 i64 값을 f64로 캐스트해 비교한다.
            let prev: Option<(f64, f64)> = if v2 {
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
                if p == w.used_percent && r == (w.resets_at as f64) {
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
    // v1(JS)이 소수부 있는 ms를 REAL로 저장한 행이 실DB에 존재 — resets_at/ts를 i64 강타입으로
    // 읽으면 거부된다. rusqlite의 f64 FromSql은 INTEGER/REAL 저장 클래스를 모두 수용한다.
    let rows: Vec<(String, f64, f64, f64)> = stmt
        .query_map(rusqlite::params![provider, account_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<Result<_, _>>()?;
    if rows.is_empty() {
        return Ok(None);
    }
    // NaN 입력 불가(rows 비어있지 않음 보장 후 f64::MIN에서 fold) — f64는 Ord 미구현이라 max() 불가.
    let fetched_at = rows.iter().map(|r| r.3).fold(f64::MIN, f64::max);
    let mut windows: Vec<&(String, f64, f64, f64)> = rows
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
        assert_eq!(snap["fetchedAt"], 2000.0);
        let windows = snap["windows"].as_array().unwrap();
        assert_eq!(windows[0]["kind"], "session_5h"); // session_5h 먼저
        assert_eq!(windows[1]["usedPercent"], 2.0); // weekly는 최신값
        assert!(latest_account_snapshot(&conn, "claude", "none").unwrap().is_none());
    }

    #[test]
    fn latest_account_snapshot_reads_real_typed_columns() {
        // v1(JS)이 소수부 있는 ms를 REAL로 저장한 실DB 행 재현 — resets_at/ts를 i64 강타입으로
        // 읽으면 거부된다. record_snapshots를 거치지 않고 v1처럼 raw REAL 값을 직접 심는다.
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        assert!(crate::store::db::apply_multi_account_schema(&mut conn));
        conn.execute(
            "INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at, account_id)
             VALUES (2000.5, 'claude', 'session_5h', 33.0, 999.5, 'a')",
            [],
        )
        .unwrap();
        let snap = latest_account_snapshot(&conn, "claude", "a").unwrap().unwrap();
        assert_eq!(snap["fetchedAt"], 2000.5);
        let windows = snap["windows"].as_array().unwrap();
        assert_eq!(windows[0]["kind"], "session_5h");
        assert_eq!(windows[0]["resetsAt"], 999.5);
        assert_eq!(windows[0]["usedPercent"], 33.0);
    }

    #[test]
    fn record_snapshots_tolerates_real_typed_prev_resets_at() {
        // 직전 행의 resets_at이 REAL 타입(v1 유산, 소수부 있는 값)이어도 dedup SELECT가
        // InvalidColumnType으로 거부되지 않아야 한다. 단, 소수부가 있는 REAL 값은 SQLite의
        // INTEGER affinity 변환으로 정수값이 될 수 없으므로(정수로 손실 없이 변환 가능한 REAL은
        // 저장 시 자동으로 INTEGER가 됨) 새 정수 poll 값(999)과는 다른 값 — dedup은 skip이 아니라
        // "에러 없이 새 행 기록"으로 이어진다. dedup-skip 자체는 record_dedups_unchanged_and_records_changed에서
        // 이미 커버한다 — 이 테스트의 목적은 REAL 타입 내성(크래시 없음)이다.
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        assert!(crate::store::db::apply_multi_account_schema(&mut conn));
        conn.execute(
            "INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at, account_id)
             VALUES (1000.5, 'claude', 'session_5h', 10.0, 999.5, 'acc-1')",
            [],
        )
        .unwrap();
        let w = vec![RateWindow { kind: "session_5h".into(), used_percent: 10.0, resets_at: 999 }];
        record_snapshots(&mut conn, "claude", 2000, &w, "acc-1").unwrap(); // 에러 없이 진행돼야 한다
        let n: i64 =
            conn.query_row("SELECT COUNT(*) FROM rate_snapshots", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2); // resets_at(999.5 vs 999)이 달라 dedup 미스 → 새 행 기록, 크래시 없음이 핵심
    }
}
