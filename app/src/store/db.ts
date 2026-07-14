// SQLite 연결 + 스키마 생성 (idempotent, CREATE TABLE/INDEX IF NOT EXISTS).
// 스펙 §5 대비 변경점: daily_usage에 folder 컬럼 없음 — 일별 CLI 출력엔 folder 정보가 없어
// folder 분석은 session_usage.folder에서 수행한다 (queries.ts의 folderRollup/sessionsInFolder).
import Database from 'better-sqlite3'

const SCHEMA = `
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
`

export function openDb(path: string | ':memory:'): Database.Database {
  const db = new Database(path)
  db.exec(SCHEMA)
  return db
}

/**
 * 멀티 계정 스키마 v2 (스펙 §저장 구조). 단일 트랜잭션 — 실패 시 원상 롤백하고 false를 반환하며,
 * 호출자(index.ts)는 멀티 계정 기능만 끄고 기존 스키마로 계속 동작한다(데이터 파괴 금지).
 * rate_snapshots는 PK에 account_id를 넣기 위해 재생성한다. 계정 미상은 NULL이 아닌 ''(PK 참여).
 */
export function applyMultiAccountSchema(db: Database.Database): boolean {
  try {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS accounts(
          provider TEXT NOT NULL, id TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '', plan TEXT,
          first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
          PRIMARY KEY(provider, id));
        CREATE TABLE IF NOT EXISTS login_periods(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL, account_id TEXT NOT NULL,
          started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_login_periods_provider ON login_periods(provider, ended_at);
      `)
      const cols = db.prepare(`PRAGMA table_info(rate_snapshots)`).all() as { name: string }[]
      if (!cols.some((c) => c.name === 'account_id')) {
        db.exec(`
          CREATE TABLE rate_snapshots_v2(
            ts INTEGER NOT NULL, provider TEXT NOT NULL, window TEXT NOT NULL,
            used_percent REAL NOT NULL, resets_at INTEGER NOT NULL,
            account_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(ts, provider, window, account_id));
          INSERT INTO rate_snapshots_v2(ts, provider, window, used_percent, resets_at, account_id)
            SELECT ts, provider, window, used_percent, resets_at, '' FROM rate_snapshots;
          DROP TABLE rate_snapshots;
          ALTER TABLE rate_snapshots_v2 RENAME TO rate_snapshots;
        `)
      }
    })
    migrate()
    return true
  } catch {
    return false
  }
}
