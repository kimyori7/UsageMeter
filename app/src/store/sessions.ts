// session_usage 업서트. PK(session_id) 충돌 시 REPLACE — 세션이 계속 이어지며 totalTokens/costUsd/
// endedAt이 갱신되는 경우를 재스캔마다 최신값으로 덮어써서 반영한다.
import type Database from 'better-sqlite3'
import type { SessionRow } from '../providers/types'

const UPSERT_SQL = `
  INSERT OR REPLACE INTO session_usage(session_id, provider, folder, started_at, ended_at, total_tokens, cost_usd)
  VALUES (@sessionId, @provider, @folder, @startedAt, @endedAt, @totalTokens, @costUsd)
`

export function upsertSessions(db: Database.Database, rows: SessionRow[]): void {
  const stmt = db.prepare(UPSERT_SQL)
  const insertMany = db.transaction((items: SessionRow[]) => {
    for (const row of items) stmt.run(row)
  })
  insertMany(rows)
}
