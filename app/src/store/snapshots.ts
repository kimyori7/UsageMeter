// rate_snapshots 기록. (provider, window, account_id)별 직전 기록과 동일하면 행을 추가하지 않는다(dedup).
// v2 스키마(account_id 컬럼)와 v1 스키마(마이그레이션 실패 폴백) 모두 지원 — 컬럼 존재로 SQL을 선택.
import type Database from 'better-sqlite3'
import type { ProviderId, RateStatus, RateWindow } from '../providers/types'

interface PrevSnapshot {
  used_percent: number
  resets_at: number
}

function hasAccountColumn(db: Database.Database): boolean {
  const cols = db.prepare(`PRAGMA table_info(rate_snapshots)`).all() as { name: string }[]
  return cols.some((c) => c.name === 'account_id')
}

export function recordSnapshots(db: Database.Database, s: RateStatus, accountId = ''): void {
  const v2 = hasAccountColumn(db)
  const selectLatest = db.prepare(
    v2
      ? `SELECT used_percent, resets_at FROM rate_snapshots
         WHERE provider = ? AND window = ? AND account_id = ? ORDER BY ts DESC LIMIT 1`
      : `SELECT used_percent, resets_at FROM rate_snapshots
         WHERE provider = ? AND window = ? ORDER BY ts DESC LIMIT 1`
  )
  const insert = db.prepare(
    v2
      ? `INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at, account_id)
         VALUES (@ts, @provider, @window, @usedPercent, @resetsAt, @accountId)`
      : `INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at)
         VALUES (@ts, @provider, @window, @usedPercent, @resetsAt)`
  )

  const run = db.transaction(() => {
    for (const w of s.windows) {
      const prev = (
        v2 ? selectLatest.get(s.provider, w.kind, accountId) : selectLatest.get(s.provider, w.kind)
      ) as PrevSnapshot | undefined
      const unchanged = prev && prev.used_percent === w.usedPercent && prev.resets_at === w.resetsAt
      if (unchanged) continue
      insert.run({
        ts: s.fetchedAt,
        provider: s.provider,
        window: w.kind,
        usedPercent: w.usedPercent,
        resetsAt: w.resetsAt,
        ...(v2 ? { accountId } : {})
      })
    }
  })
  run()
}

export interface AccountSnapshot {
  windows: RateWindow[]
  fetchedAt: number
}

/** 해당 계정의 창별 최신 스냅샷으로 RateStatus 유사 구조를 재구성한다. 행이 없으면 null. */
export function latestAccountSnapshot(
  db: Database.Database,
  provider: ProviderId,
  accountId: string
): AccountSnapshot | null {
  // SQLite의 bare-column + MAX(ts) 규칙: 그룹 내 MAX 행의 나머지 컬럼 값이 선택된다.
  const rows = db
    .prepare(
      `SELECT window, used_percent, resets_at, MAX(ts) AS ts FROM rate_snapshots
       WHERE provider = ? AND account_id = ? GROUP BY window`
    )
    .all(provider, accountId) as {
    window: string
    used_percent: number
    resets_at: number
    ts: number
  }[]
  if (rows.length === 0) return null
  const windows = rows
    .filter(
      (r): r is typeof r & { window: RateWindow['kind'] } =>
        r.window === 'session_5h' || r.window === 'weekly'
    )
    .map((r) => ({ kind: r.window, usedPercent: r.used_percent, resetsAt: r.resets_at }))
    .sort((a, b) => (a.kind === 'session_5h' ? -1 : 1) - (b.kind === 'session_5h' ? -1 : 1))
  return { windows, fetchedAt: Math.max(...rows.map((r) => r.ts)) }
}
