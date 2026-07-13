import { describe, it, expect } from 'vitest'
import { openDb } from './db'
import { upsertSessions } from './sessions'
import type { SessionRow } from '../providers/types'

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: 's1',
    provider: 'claude',
    folder: 'f1',
    startedAt: '2026-07-01T00:00:00.000Z',
    endedAt: '2026-07-01T01:00:00.000Z',
    totalTokens: 1000,
    costUsd: 1,
    ...overrides
  }
}

describe('upsertSessions', () => {
  it('같은 sessionId 재실행 시 행 수는 그대로, 값은 최신으로 갱신', () => {
    const db = openDb(':memory:')
    upsertSessions(db, [row()])
    upsertSessions(db, [row({ costUsd: 5, endedAt: '2026-07-01T02:00:00.000Z' })])

    const rows = db.prepare('SELECT * FROM session_usage').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ cost_usd: 5, ended_at: '2026-07-01T02:00:00.000Z' })
  })

  it('startedAt/endedAt이 null이어도 삽입 가능', () => {
    const db = openDb(':memory:')
    upsertSessions(db, [row({ sessionId: 's2', startedAt: null, endedAt: null })])

    const r = db.prepare('SELECT * FROM session_usage WHERE session_id = ?').get('s2')
    expect(r).toMatchObject({ started_at: null, ended_at: null })
  })
})
