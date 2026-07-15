// 계정 레지스트리(accounts)와 로그인 타임라인(login_periods) — v1 store/accounts.ts 이식.
// login_periods는 이번 릴리스에서 읽지 않는다 — 2차(계정별 사용량 귀속)용 데이터 축적만.
use rusqlite::{Connection, OptionalExtension};

#[derive(Debug, Clone, PartialEq)]
pub struct AccountRecord {
    pub provider: String,
    pub id: String,
    pub email: String,
    pub plan: Option<String>,
    // v1(JS) 기록 유산 방어로 f64 읽기 — i64 강타입 읽기 금지(P2 REAL-ts 교훈)
    pub first_seen_at: f64,
    pub last_seen_at: f64,
}

pub fn upsert_account(
    conn: &Connection,
    provider: &str,
    id: &str,
    email: &str,
    plan: Option<&str>,
    now_ms: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO accounts(provider, id, email, plan, first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(provider, id) DO UPDATE SET
           email = CASE WHEN excluded.email = '' THEN accounts.email ELSE excluded.email END,
           plan = COALESCE(excluded.plan, accounts.plan),
           last_seen_at = excluded.last_seen_at",
        rusqlite::params![provider, id, email, plan, now_ms],
    )?;
    Ok(())
}

pub fn list_accounts(conn: &Connection, provider: &str) -> rusqlite::Result<Vec<AccountRecord>> {
    let mut stmt = conn.prepare(
        "SELECT provider, id, email, plan, first_seen_at, last_seen_at
         FROM accounts WHERE provider = ? ORDER BY last_seen_at DESC",
    )?;
    let rows = stmt
        .query_map([provider], |r| {
            Ok(AccountRecord {
                provider: r.get(0)?,
                id: r.get(1)?,
                email: r.get(2)?,
                plan: r.get(3)?,
                first_seen_at: r.get(4)?,
                last_seen_at: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn touch_login_period(
    conn: &Connection,
    provider: &str,
    account_id: &str,
    now_ms: i64,
) -> rusqlite::Result<()> {
    let latest: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, account_id FROM login_periods
             WHERE provider = ? ORDER BY ended_at DESC, id DESC LIMIT 1",
            [provider],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match latest {
        Some((row_id, acc)) if acc == account_id => {
            conn.execute(
                "UPDATE login_periods SET ended_at = ? WHERE id = ?",
                rusqlite::params![now_ms, row_id],
            )?;
        }
        _ => {
            conn.execute(
                "INSERT INTO login_periods(provider, account_id, started_at, ended_at)
                 VALUES (?, ?, ?, ?)",
                rusqlite::params![provider, account_id, now_ms, now_ms],
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // TempDir을 함께 반환해 테스트 수명 동안 디렉터리를 유지한다 (P2 테스트 패턴)
    fn db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        assert!(crate::store::db::apply_multi_account_schema(&mut conn));
        (dir, conn)
    }

    #[test]
    fn upsert_inserts_then_updates_with_v1_merge_rules() {
        let (_dir, conn) = db();
        upsert_account(&conn, "claude", "a1", "a@b.com", Some("max"), 1000).unwrap();
        // email '' 은 기존 값 유지, plan None은 COALESCE로 기존 값 유지, last_seen만 갱신
        upsert_account(&conn, "claude", "a1", "", None, 2000).unwrap();
        let recs = list_accounts(&conn, "claude").unwrap();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].email, "a@b.com");
        assert_eq!(recs[0].plan.as_deref(), Some("max"));
        assert_eq!(recs[0].first_seen_at, 1000.0);
        assert_eq!(recs[0].last_seen_at, 2000.0);
        // 새 email/plan은 덮어쓴다
        upsert_account(&conn, "claude", "a1", "new@b.com", Some("pro"), 3000).unwrap();
        let recs = list_accounts(&conn, "claude").unwrap();
        assert_eq!(recs[0].email, "new@b.com");
        assert_eq!(recs[0].plan.as_deref(), Some("pro"));
    }

    #[test]
    fn list_orders_by_last_seen_desc_and_filters_provider() {
        let (_dir, conn) = db();
        upsert_account(&conn, "claude", "old", "o@b.com", None, 1000).unwrap();
        upsert_account(&conn, "claude", "new", "n@b.com", None, 2000).unwrap();
        upsert_account(&conn, "codex", "cx", "c@b.com", None, 3000).unwrap();
        let recs = list_accounts(&conn, "claude").unwrap();
        assert_eq!(recs.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["new", "old"]);
    }

    #[test]
    fn touch_extends_same_account_and_starts_new_period_on_switch() {
        let (_dir, conn) = db();
        touch_login_period(&conn, "claude", "a1", 1000).unwrap();
        touch_login_period(&conn, "claude", "a1", 2000).unwrap(); // 연장
        touch_login_period(&conn, "claude", "a2", 3000).unwrap(); // 전환 → 새 행
        let rows: Vec<(String, i64, i64)> = conn
            .prepare("SELECT account_id, started_at, ended_at FROM login_periods ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(rows, vec![("a1".into(), 1000, 2000), ("a2".into(), 3000, 3000)]);
    }
}
