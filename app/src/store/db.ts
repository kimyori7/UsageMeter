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
