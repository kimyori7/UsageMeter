// daily_usage 업서트. PK(date, provider, model) 충돌 시 REPLACE — 재스캔 때마다 최신값으로 덮어써
// Claude Code가 30일 뒤 지우는 원본 로그 대신 DB가 영구 히스토리를 보존한다.
import type Database from 'better-sqlite3'
import type { DailyRow } from '../providers/types'

const UPSERT_SQL = `
  INSERT OR REPLACE INTO daily_usage(date, provider, model, input_tokens, output_tokens, cache_tokens, cost_usd)
  VALUES (@date, @provider, @model, @inputTokens, @outputTokens, @cacheTokens, @costUsd)
`

export function upsertDaily(db: Database.Database, rows: DailyRow[]): void {
  const stmt = db.prepare(UPSERT_SQL)
  const insertMany = db.transaction((items: DailyRow[]) => {
    for (const row of items) stmt.run(row)
  })
  insertMany(rows)
}
