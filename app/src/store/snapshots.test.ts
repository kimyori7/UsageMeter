import { describe, it, expect } from 'vitest'
import { openDb, applyMultiAccountSchema } from './db'
import { recordSnapshots, latestAccountSnapshot } from './snapshots'
import type Database from 'better-sqlite3'
import type { RateStatus } from '../providers/types'

function status(overrides: Partial<RateStatus> = {}): RateStatus {
  return {
    provider: 'claude',
    windows: [{ kind: 'session_5h', usedPercent: 10, resetsAt: 1000 }],
    fetchedAt: 1,
    ...overrides
  }
}

describe('recordSnapshots', () => {
  it('창(window)별로 1행씩 기록', () => {
    const db = openDb(':memory:')
    recordSnapshots(
      db,
      status({
        windows: [
          { kind: 'session_5h', usedPercent: 10, resetsAt: 1000 },
          { kind: 'weekly', usedPercent: 20, resetsAt: 2000 }
        ]
      })
    )

    const rows = db.prepare('SELECT * FROM rate_snapshots').all()
    expect(rows).toHaveLength(2)
  })

  it('직전값과 동일하면 새 행을 추가하지 않고 skip, 값이 바뀌면 새 행 추가', () => {
    const db = openDb(':memory:')
    recordSnapshots(db, status({ fetchedAt: 1 }))
    recordSnapshots(db, status({ fetchedAt: 2 })) // usedPercent/resetsAt 동일 → skip

    const rows = db.prepare('SELECT * FROM rate_snapshots').all()
    expect(rows).toHaveLength(1)

    recordSnapshots(
      db,
      status({ fetchedAt: 3, windows: [{ kind: 'session_5h', usedPercent: 15, resetsAt: 1000 }] })
    )
    const rows2 = db.prepare('SELECT * FROM rate_snapshots ORDER BY ts').all()
    expect(rows2).toHaveLength(2)
    expect(rows2[1]).toMatchObject({ ts: 3, used_percent: 15 })
  })
})

describe('계정 태깅', () => {
  function v2db(): Database.Database {
    const db = openDb(':memory:')
    expect(applyMultiAccountSchema(db)).toBe(true)
    return db
  }
  const status = (fetchedAt: number, used: number): RateStatus => ({
    provider: 'claude',
    windows: [
      { kind: 'session_5h', usedPercent: used, resetsAt: 9000 },
      { kind: 'weekly', usedPercent: used + 1, resetsAt: 99000 }
    ],
    fetchedAt
  })

  it('같은 수치라도 계정이 다르면 각각 기록된다(dedup은 계정 단위)', () => {
    const db = v2db()
    recordSnapshots(db, status(1000, 10), 'acc-A')
    recordSnapshots(db, status(2000, 10), 'acc-B') // 동일 %·resets — 계정이 다르므로 기록돼야 함
    recordSnapshots(db, status(3000, 10), 'acc-A') // acc-A 기준 무변화 — dedup
    const count = db.prepare(`SELECT COUNT(*) AS n FROM rate_snapshots`).get() as { n: number }
    expect(count.n).toBe(4) // A 2창 + B 2창
  })

  it('accountId 생략(레거시 호출) → account_id="" 행', () => {
    const db = v2db()
    recordSnapshots(db, status(1000, 10))
    const row = db.prepare(`SELECT account_id FROM rate_snapshots LIMIT 1`).get() as {
      account_id: string
    }
    expect(row.account_id).toBe('')
  })

  it('latestAccountSnapshot: 창별 최신 행으로 재구성(세션→주간), 없으면 null', () => {
    const db = v2db()
    recordSnapshots(db, status(1000, 10), 'acc-A')
    recordSnapshots(db, status(5000, 55), 'acc-A')
    const snap = latestAccountSnapshot(db, 'claude', 'acc-A')
    expect(snap?.fetchedAt).toBe(5000)
    expect(snap?.windows).toEqual([
      { kind: 'session_5h', usedPercent: 55, resetsAt: 9000 },
      { kind: 'weekly', usedPercent: 56, resetsAt: 99000 }
    ])
    expect(latestAccountSnapshot(db, 'claude', 'no-such')).toBeNull()
  })

  it('v1 스키마(account_id 없음)에서도 레거시 기록이 계속 동작한다', () => {
    const db = openDb(':memory:') // 마이그레이션 미적용
    recordSnapshots(db, status(1000, 10))
    const count = db.prepare(`SELECT COUNT(*) AS n FROM rate_snapshots`).get() as { n: number }
    expect(count.n).toBe(2)
  })
})
