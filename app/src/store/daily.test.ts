import { describe, it, expect } from 'vitest'
import { openDb } from './db'
import { upsertDaily } from './daily'
import type { DailyRow } from '../providers/types'

function row(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: '2026-07-01',
    provider: 'claude',
    model: 'claude-fable-5',
    inputTokens: 100,
    outputTokens: 200,
    cacheTokens: 10,
    costUsd: 1.5,
    ...overrides
  }
}

describe('upsertDaily', () => {
  it('같은 (date, provider, model) 재실행 시 행 수는 그대로, 값은 최신으로 갱신', () => {
    const db = openDb(':memory:')
    upsertDaily(db, [row()])
    upsertDaily(db, [row({ costUsd: 3, inputTokens: 500 })])

    const rows = db.prepare('SELECT * FROM daily_usage').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ cost_usd: 3, input_tokens: 500 })
  })

  it('서로 다른 model이면 별도 행으로 쌓임', () => {
    const db = openDb(':memory:')
    upsertDaily(db, [row({ model: 'a' }), row({ model: 'b' })])

    const rows = db.prepare('SELECT * FROM daily_usage').all()
    expect(rows).toHaveLength(2)
  })
})
