// rate_snapshots 기록. RateStatus의 창(window)마다 1행씩 남기되, 해당 (provider, window)의
// 직전 기록값(usedPercent, resetsAt)과 동일하면 새 행을 추가하지 않는다 — 값 변화가 없는 동안
// 폴링할 때마다 행이 쌓이는 것을 막기 위한 dedup.
import type Database from 'better-sqlite3'
import type { RateStatus } from '../providers/types'

interface PrevSnapshot {
  used_percent: number
  resets_at: number
}

const SELECT_LATEST_SQL = `
  SELECT used_percent, resets_at FROM rate_snapshots
  WHERE provider = ? AND window = ?
  ORDER BY ts DESC LIMIT 1
`

const INSERT_SQL = `
  INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at)
  VALUES (@ts, @provider, @window, @usedPercent, @resetsAt)
`

export function recordSnapshots(db: Database.Database, s: RateStatus): void {
  const selectLatest = db.prepare(SELECT_LATEST_SQL)
  const insert = db.prepare(INSERT_SQL)

  const run = db.transaction(() => {
    for (const w of s.windows) {
      const prev = selectLatest.get(s.provider, w.kind) as PrevSnapshot | undefined
      const unchanged = prev && prev.used_percent === w.usedPercent && prev.resets_at === w.resetsAt
      if (unchanged) continue
      insert.run({
        ts: s.fetchedAt,
        provider: s.provider,
        window: w.kind,
        usedPercent: w.usedPercent,
        resetsAt: w.resetsAt
      })
    }
  })
  run()
}
