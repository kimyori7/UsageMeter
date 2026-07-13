import { describe, it, expect } from 'vitest'
import { openDb } from './db'
import { recordSnapshots } from './snapshots'
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
