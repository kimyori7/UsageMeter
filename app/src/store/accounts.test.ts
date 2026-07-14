import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyMultiAccountSchema, openDb } from './db'
import { listAccounts, touchLoginPeriod, upsertAccount } from './accounts'

function freshDb(): Database.Database {
  const db = openDb(':memory:')
  expect(applyMultiAccountSchema(db)).toBe(true)
  return db
}

describe('applyMultiAccountSchema', () => {
  it('신규 DB에 적용되고 재실행해도 안전하다(idempotent)', () => {
    const db = openDb(':memory:')
    expect(applyMultiAccountSchema(db)).toBe(true)
    expect(applyMultiAccountSchema(db)).toBe(true)
    const cols = db.prepare(`PRAGMA table_info(rate_snapshots)`).all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('account_id')
  })

  it('기존 v1 스냅샷 행을 보존하고 account_id=""로 채운다', () => {
    const db = openDb(':memory:')
    db.prepare(
      `INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at) VALUES (1000, 'claude', 'weekly', 42, 2000)`
    ).run()
    expect(applyMultiAccountSchema(db)).toBe(true)
    const row = db.prepare(`SELECT * FROM rate_snapshots`).get() as Record<string, unknown>
    expect(row.used_percent).toBe(42)
    expect(row.account_id).toBe('')
  })
})

describe('upsertAccount / listAccounts', () => {
  it('신규 삽입 후 email·plan·last_seen을 갱신하되 빈 email로 덮지 않는다', () => {
    const db = freshDb()
    upsertAccount(db, { provider: 'codex', id: 'a1', email: 'x@y.com', plan: 'plus' }, 1000)
    upsertAccount(db, { provider: 'codex', id: 'a1', email: '' }, 2000) // rollout 폴백 등 email 미상 틱
    const [acc] = listAccounts(db, 'codex')
    expect(acc.email).toBe('x@y.com') // 보존
    expect(acc.plan).toBe('plus') // COALESCE 보존
    expect(acc.firstSeenAt).toBe(1000)
    expect(acc.lastSeenAt).toBe(2000)
  })

  it('provider별로 last_seen 내림차순 목록', () => {
    const db = freshDb()
    upsertAccount(db, { provider: 'claude', id: 'old', email: 'o@o.com' }, 1000)
    upsertAccount(db, { provider: 'claude', id: 'new', email: 'n@n.com' }, 2000)
    upsertAccount(db, { provider: 'codex', id: 'other', email: 'c@c.com' }, 3000)
    expect(listAccounts(db, 'claude').map((a) => a.id)).toEqual(['new', 'old'])
  })
})

describe('touchLoginPeriod', () => {
  it('같은 계정 연속 틱은 구간을 연장하고, 계정이 바뀌면 새 구간을 연다', () => {
    const db = freshDb()
    touchLoginPeriod(db, 'claude', 'a1', 1000)
    touchLoginPeriod(db, 'claude', 'a1', 2000)
    touchLoginPeriod(db, 'claude', 'a2', 3000)
    const rows = db
      .prepare(`SELECT account_id, started_at, ended_at FROM login_periods ORDER BY id`)
      .all() as { account_id: string; started_at: number; ended_at: number }[]
    expect(rows).toEqual([
      { account_id: 'a1', started_at: 1000, ended_at: 2000 },
      { account_id: 'a2', started_at: 3000, ended_at: 3000 }
    ])
  })
})
