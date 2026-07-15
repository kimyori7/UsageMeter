// 대시보드 전용 읽기 쿼리 — v1 app/src/store/queries.ts의 1:1 이식.
// SQL 문자열 + 파라미터 바인딩만 사용, 집계는 SQLite(GROUP BY/SUM)에 맡긴다.
// folder_rollup만 provider별 행을 폴더 단위로 Rust에서 병합한다(providers 배열 생성).
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RangeOpts {
    pub from: Option<String>,
    pub to: Option<String>,
    pub providers: Option<Vec<String>>,
}

fn provider_filter(providers: &Option<Vec<String>>) -> (Option<String>, Vec<String>) {
    match providers {
        Some(list) if !list.is_empty() => {
            let marks = vec!["?"; list.len()].join(",");
            (Some(format!("provider IN ({marks})")), list.clone())
        }
        _ => (None, Vec::new()),
    }
}

// 'localtime' 변환이 필수인 이유(v1 주석 승계): ended_at은 Z 접미사 UTC, from/to는 렌더러가
// 로컬 Date 게터로 만든 로컬 캘린더 일. 변환 없이 date()로 UTC 일을 추출하면 KST 같은
// 양수 오프셋에서 자정~09시 종료 세션이 폴더 탭에서만 전날로 밀린다.
fn date_range_filter(opts: &RangeOpts) -> (Vec<String>, Vec<String>) {
    let mut clauses = Vec::new();
    let mut params = Vec::new();
    if let Some(from) = &opts.from {
        clauses.push("date(ended_at, 'localtime') >= ?".to_string());
        params.push(from.clone());
    }
    if let Some(to) = &opts.to {
        clauses.push("date(ended_at, 'localtime') <= ?".to_string());
        params.push(to.clone());
    }
    (clauses, params)
}

fn where_sql(conditions: &[String]) -> String {
    if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    }
}

pub fn daily_totals(conn: &Connection, opts: &RangeOpts) -> rusqlite::Result<Vec<Value>> {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();
    if let Some(from) = &opts.from {
        conditions.push("date >= ?".into());
        params.push(from.clone());
    }
    if let Some(to) = &opts.to {
        conditions.push("date <= ?".into());
        params.push(to.clone());
    }
    let (clause, provider_params) = provider_filter(&opts.providers);
    if let Some(c) = clause {
        conditions.push(c);
        params.extend(provider_params);
    }
    let sql = format!(
        "SELECT date, provider, SUM(cost_usd) AS costUsd,
                SUM(input_tokens + output_tokens + cache_tokens) AS totalTokens
         FROM daily_usage {} GROUP BY date, provider ORDER BY date, provider",
        where_sql(&conditions)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params.iter()), |row| {
        Ok(json!({
            "date": row.get::<_, String>(0)?,
            "provider": row.get::<_, String>(1)?,
            "costUsd": row.get::<_, f64>(2)?,
            "totalTokens": row.get::<_, i64>(3)?,
        }))
    })?;
    rows.collect()
}

pub fn today_by_provider(conn: &Connection, today: &str) -> rusqlite::Result<Value> {
    let mut stmt = conn.prepare(
        "SELECT provider, SUM(cost_usd) AS costUsd,
                SUM(input_tokens + output_tokens + cache_tokens) AS totalTokens
         FROM daily_usage WHERE date = ? GROUP BY provider",
    )?;
    let mut result = json!({
        "claude": { "costUsd": 0.0, "totalTokens": 0 },
        "codex": { "costUsd": 0.0, "totalTokens": 0 }
    });
    let rows: Vec<(String, f64, i64)> = stmt
        .query_map([today], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<_, _>>()?;
    for (provider, cost, tokens) in rows {
        result[provider.as_str()] = json!({ "costUsd": cost, "totalTokens": tokens });
    }
    Ok(result)
}

pub fn folder_rollup(conn: &Connection, opts: &RangeOpts) -> rusqlite::Result<Vec<Value>> {
    let (clause, provider_params) = provider_filter(&opts.providers);
    let (date_clauses, date_params) = date_range_filter(opts);
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();
    if let Some(c) = clause {
        conditions.push(c);
        params.extend(provider_params);
    }
    conditions.extend(date_clauses);
    params.extend(date_params);
    let sql = format!(
        "SELECT folder, provider, SUM(cost_usd) AS costUsd, SUM(total_tokens) AS totalTokens
         FROM session_usage {} GROUP BY folder, provider ORDER BY folder",
        where_sql(&conditions)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<(String, String, f64, i64)> = stmt
        .query_map(params_from_iter(params.iter()), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<_, _>>()?;

    // folder 정렬 순으로 도착하므로 연속 구간 병합 = v1의 Map 삽입 순서와 동일한 결과
    let mut out: Vec<Value> = Vec::new();
    for (folder, provider, cost, tokens) in rows {
        match out.last_mut() {
            Some(last) if last["folder"] == folder.as_str() => {
                last["providers"].as_array_mut().unwrap().push(json!(provider));
                last["costUsd"] = json!(last["costUsd"].as_f64().unwrap() + cost);
                last["totalTokens"] = json!(last["totalTokens"].as_i64().unwrap() + tokens);
            }
            _ => out.push(json!({
                "folder": folder,
                "providers": [provider],
                "costUsd": cost,
                "totalTokens": tokens,
            })),
        }
    }
    Ok(out)
}

pub fn sessions_in_folder(
    conn: &Connection,
    folder: &str,
    opts: &RangeOpts,
) -> rusqlite::Result<Vec<Value>> {
    let mut conditions: Vec<String> = vec!["folder = ?".into()];
    let mut params: Vec<String> = vec![folder.to_string()];
    let (clause, provider_params) = provider_filter(&opts.providers);
    if let Some(c) = clause {
        conditions.push(c);
        params.extend(provider_params);
    }
    let (date_clauses, date_params) = date_range_filter(opts);
    conditions.extend(date_clauses);
    params.extend(date_params);
    let sql = format!(
        "SELECT session_id, provider, folder, started_at, ended_at, total_tokens, cost_usd
         FROM session_usage WHERE {}",
        conditions.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(params.iter()), |row| {
        Ok(json!({
            "sessionId": row.get::<_, String>(0)?,
            "provider": row.get::<_, String>(1)?,
            "folder": row.get::<_, String>(2)?,
            "startedAt": row.get::<_, Option<String>>(3)?,
            "endedAt": row.get::<_, Option<String>>(4)?,
            "totalTokens": row.get::<_, i64>(5)?,
            "costUsd": row.get::<_, f64>(6)?,
        }))
    })?;
    rows.collect()
}

pub fn monthly_rollup(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT substr(date, 1, 7) AS month, provider, model,
                SUM(cost_usd) AS costUsd, SUM(input_tokens + output_tokens + cache_tokens) AS totalTokens
         FROM daily_usage
         GROUP BY month, provider, model
         ORDER BY month, provider, model",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(json!({
            "month": row.get::<_, String>(0)?,
            "provider": row.get::<_, String>(1)?,
            "model": row.get::<_, String>(2)?,
            "costUsd": row.get::<_, f64>(3)?,
            "totalTokens": row.get::<_, i64>(4)?,
        }))
    })?;
    rows.collect()
}

pub fn snapshot_series(
    conn: &Connection,
    provider: &str,
    window: &str,
    from: i64,
) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT ts, used_percent AS usedPercent FROM rate_snapshots
         WHERE provider = ? AND window = ? AND ts >= ?
         ORDER BY ts ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![provider, window, from], |row| {
        Ok(json!({
            "ts": row.get::<_, i64>(0)?,
            "usedPercent": row.get::<_, f64>(1)?,
        }))
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db::open_db;
    use rusqlite::Connection;

    fn seeded() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("usage.db")).unwrap();
        conn.execute_batch(
            "INSERT INTO daily_usage VALUES
               ('2026-07-14','claude','opus',10,20,30,1.0),
               ('2026-07-14','codex','gpt',1,2,3,0.5),
               ('2026-07-15','claude','opus',100,200,300,2.0),
               ('2026-07-15','claude','sonnet',10,10,10,0.25);
             INSERT INTO session_usage VALUES
               ('s1','claude','D:/proj/a','2026-07-15T00:00:00Z','2026-07-15T03:00:00Z',600,3.0),
               ('s2','codex','D:/proj/a',NULL,'2026-07-15T04:00:00Z',60,0.5),
               ('s3','claude','D:/proj/b','2026-07-01T00:00:00Z','2026-07-01T01:00:00Z',30,0.1);
             INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at)
               VALUES (100,'claude','session_5h',10.0,999),
                      (200,'claude','session_5h',20.0,999),
                      (200,'claude','weekly',5.0,999),
                      (300,'codex','session_5h',50.0,999);",
        )
        .unwrap();
        (dir, conn)
    }

    #[test]
    fn daily_totals_groups_and_filters() {
        let (_d, conn) = seeded();
        let all = daily_totals(&conn, &RangeOpts::default()).unwrap();
        // (date, provider) 그룹: 07-14 claude / 07-14 codex / 07-15 claude(모델 2개 합산)
        assert_eq!(all.len(), 3);
        let last = &all[2];
        assert_eq!(last["date"], "2026-07-15");
        assert_eq!(last["provider"], "claude");
        assert_eq!(last["costUsd"], 2.25);
        assert_eq!(last["totalTokens"], 630);
        // from/to + providers 필터
        let filtered = daily_totals(
            &conn,
            &RangeOpts {
                from: Some("2026-07-15".into()),
                to: Some("2026-07-15".into()),
                providers: Some(vec!["claude".into()]),
            },
        )
        .unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0]["totalTokens"], 630);
    }

    #[test]
    fn today_by_provider_defaults_zero() {
        let (_d, conn) = seeded();
        let v = today_by_provider(&conn, "2026-07-14").unwrap();
        assert_eq!(v["claude"]["costUsd"], 1.0);
        assert_eq!(v["codex"]["totalTokens"], 6);
        let empty = today_by_provider(&conn, "1999-01-01").unwrap();
        assert_eq!(empty["claude"]["costUsd"], 0.0);
        assert_eq!(empty["codex"]["costUsd"], 0.0);
    }

    #[test]
    fn folder_rollup_merges_providers() {
        let (_d, conn) = seeded();
        let rows = folder_rollup(&conn, &RangeOpts::default()).unwrap();
        assert_eq!(rows.len(), 2); // D:/proj/a, D:/proj/b (folder 정렬 순)
        let a = &rows[0];
        assert_eq!(a["folder"], "D:/proj/a");
        assert_eq!(a["providers"], serde_json::json!(["claude", "codex"]));
        // 0.5는 이진 부동소수로 정확 — 0.3 같은 비정확값을 시드에 쓰면 f64 합 비교가 흔들린다
        assert_eq!(a["costUsd"], 3.5);
        assert_eq!(a["totalTokens"], 660);
    }

    #[test]
    fn session_date_filter_uses_localtime() {
        let (_d, conn) = seeded();
        // 기대값을 머신 TZ에 상관없이 SQLite 자신에게 물어 계산한다 (v1과 동일한 변환식 검증)
        let local_day: String = conn
            .query_row("SELECT date('2026-07-15T03:00:00Z', 'localtime')", [], |r| r.get(0))
            .unwrap();
        let rows = sessions_in_folder(
            &conn,
            "D:/proj/a",
            &RangeOpts { from: Some(local_day.clone()), to: Some(local_day), providers: None },
        )
        .unwrap();
        assert!(rows.iter().any(|r| r["sessionId"] == "s1"));
        let s1 = rows.iter().find(|r| r["sessionId"] == "s1").unwrap();
        assert_eq!(s1["startedAt"], "2026-07-15T00:00:00Z");
        let s2 = rows.iter().find(|r| r["sessionId"] == "s2");
        if let Some(s2) = s2 {
            assert_eq!(s2["startedAt"], serde_json::Value::Null); // NULL → JSON null
        }
    }

    #[test]
    fn monthly_rollup_by_model() {
        let (_d, conn) = seeded();
        let rows = monthly_rollup(&conn).unwrap();
        // 2026-07 × (claude opus / claude sonnet / codex gpt)
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["month"], "2026-07");
        assert!(rows.iter().any(|r| r["model"] == "sonnet" && r["costUsd"] == 0.25));
    }

    #[test]
    fn snapshot_series_filters_and_orders() {
        let (_d, conn) = seeded();
        let rows = snapshot_series(&conn, "claude", "session_5h", 150).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["ts"], 200);
        assert_eq!(rows[0]["usedPercent"], 20.0);
    }
}
