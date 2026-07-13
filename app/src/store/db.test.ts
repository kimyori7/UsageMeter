import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'

describe('openDb', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('in-memory DB에 세 테이블 + 인덱스를 생성하고 각 테이블에 삽입 가능', () => {
    const db = openDb(':memory:')
    db.prepare(
      `INSERT INTO daily_usage(date, provider, model, input_tokens, output_tokens, cache_tokens, cost_usd)
       VALUES ('2026-07-01', 'claude', 'm', 1, 2, 3, 0.1)`
    ).run()
    db.prepare(
      `INSERT INTO session_usage(session_id, provider, folder, total_tokens, cost_usd)
       VALUES ('s1', 'claude', 'f', 1, 0.1)`
    ).run()
    db.prepare(
      `INSERT INTO rate_snapshots(ts, provider, window, used_percent, resets_at)
       VALUES (1, 'claude', 'weekly', 1, 1)`
    ).run()

    expect(db.prepare('SELECT COUNT(*) AS n FROM daily_usage').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_usage').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM rate_snapshots').get()).toEqual({ n: 1 })
    db.close()
  })

  it('같은 파일 경로로 재호출해도 에러 없이 idempotent (기존 데이터 보존)', () => {
    dir = mkdtempSync(join(tmpdir(), 'usagemeter-db-'))
    const file = join(dir, 'test.db')

    const first = openDb(file)
    first
      .prepare(
        `INSERT INTO daily_usage(date, provider, model, input_tokens, output_tokens, cache_tokens, cost_usd)
         VALUES ('2026-07-01', 'claude', 'm', 1, 2, 3, 0.1)`
      )
      .run()
    first.close()

    const second = openDb(file)
    expect(() => second.prepare('SELECT * FROM daily_usage').all()).not.toThrow()
    expect(second.prepare('SELECT COUNT(*) AS n FROM daily_usage').get()).toEqual({ n: 1 })
    second.close()
  })
})
