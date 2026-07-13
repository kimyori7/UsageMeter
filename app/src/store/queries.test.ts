import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import { upsertDaily } from './daily'
import { upsertSessions } from './sessions'
import { recordSnapshots } from './snapshots'
import {
  dailyTotals,
  todayByProvider,
  folderRollup,
  sessionsInFolder,
  monthlyRollup,
  snapshotSeries
} from './queries'

describe('queries', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openDb(':memory:')
    upsertDaily(db, [
      {
        date: '2026-06-01',
        provider: 'claude',
        model: 'm1',
        inputTokens: 100,
        outputTokens: 100,
        cacheTokens: 0,
        costUsd: 1
      },
      {
        date: '2026-07-01',
        provider: 'claude',
        model: 'm1',
        inputTokens: 100,
        outputTokens: 100,
        cacheTokens: 0,
        costUsd: 2
      },
      {
        date: '2026-07-01',
        provider: 'codex',
        model: 'm2',
        inputTokens: 50,
        outputTokens: 50,
        cacheTokens: 0,
        costUsd: 3
      },
      {
        date: '2026-07-02',
        provider: 'claude',
        model: 'm1',
        inputTokens: 10,
        outputTokens: 10,
        cacheTokens: 0,
        costUsd: 0.5
      }
    ])
    upsertSessions(db, [
      {
        sessionId: 'c1',
        provider: 'claude',
        folder: 'proj',
        startedAt: null,
        endedAt: null,
        totalTokens: 100,
        costUsd: 1
      },
      {
        sessionId: 'x1',
        provider: 'codex',
        folder: 'proj',
        startedAt: null,
        endedAt: null,
        totalTokens: 200,
        costUsd: 2
      },
      {
        sessionId: 'c2',
        provider: 'claude',
        folder: 'other',
        startedAt: null,
        endedAt: null,
        totalTokens: 300,
        costUsd: 3
      }
    ])
    recordSnapshots(db, {
      provider: 'claude',
      windows: [{ kind: 'weekly', usedPercent: 10, resetsAt: 100 }],
      fetchedAt: 10
    })
    recordSnapshots(db, {
      provider: 'claude',
      windows: [{ kind: 'weekly', usedPercent: 20, resetsAt: 100 }],
      fetchedAt: 20
    })
  })

  it('dailyTotals: from/to로 날짜 범위, providers로 프로바이더 필터링', () => {
    const rows = dailyTotals(db, { from: '2026-07-01', to: '2026-07-01' })
    expect(rows).toEqual([
      { date: '2026-07-01', provider: 'claude', costUsd: 2, totalTokens: 200 },
      { date: '2026-07-01', provider: 'codex', costUsd: 3, totalTokens: 100 }
    ])

    const claudeOnly = dailyTotals(db, { providers: ['claude'] })
    expect(claudeOnly).toHaveLength(3)
    expect(claudeOnly.every((r) => r.provider === 'claude')).toBe(true)
  })

  it('todayByProvider: 지정 날짜의 provider별 합계, 데이터 없는 provider는 0', () => {
    const result = todayByProvider(db, '2026-07-01')
    expect(result.claude).toEqual({ costUsd: 2, totalTokens: 200 })
    expect(result.codex).toEqual({ costUsd: 3, totalTokens: 100 })

    const empty = todayByProvider(db, '2099-01-01')
    expect(empty.claude).toEqual({ costUsd: 0, totalTokens: 0 })
    expect(empty.codex).toEqual({ costUsd: 0, totalTokens: 0 })
  })

  it('folderRollup: 같은 folder에 걸친 두 provider를 한 행으로 병합', () => {
    const rows = folderRollup(db)
    const proj = rows.find((r) => r.folder === 'proj')
    expect(proj?.providers.slice().sort()).toEqual(['claude', 'codex'])
    expect(proj?.costUsd).toBe(3)
    expect(proj?.totalTokens).toBe(300)

    const other = rows.find((r) => r.folder === 'other')
    expect(other?.providers).toEqual(['claude'])
  })

  it('sessionsInFolder: 지정 folder의 세션만 반환하고 snake_case 컬럼을 SessionRow 형태로 매핑', () => {
    const rows = sessionsInFolder(db, 'proj')
    expect(rows.map((r) => r.sessionId).sort()).toEqual(['c1', 'x1'])
    const c1 = rows.find((r) => r.sessionId === 'c1')
    expect(c1).toEqual({
      sessionId: 'c1',
      provider: 'claude',
      folder: 'proj',
      startedAt: null,
      endedAt: null,
      totalTokens: 100,
      costUsd: 1
    })
  })

  it('folderRollup: from/to로 세션 종료일(ended_at) 기준 기간 필터링(양끝 포함)', () => {
    upsertSessions(db, [
      {
        sessionId: 'd1',
        provider: 'claude',
        folder: 'dated',
        startedAt: null,
        endedAt: '2026-07-01T10:00:00Z',
        totalTokens: 10,
        costUsd: 1
      },
      {
        sessionId: 'd2',
        provider: 'claude',
        folder: 'dated',
        startedAt: null,
        endedAt: '2026-07-10T23:59:00Z',
        totalTokens: 20,
        costUsd: 2
      }
    ])

    const inRange = folderRollup(db, { from: '2026-07-05', to: '2026-07-10' })
    const dated = inRange.find((r) => r.folder === 'dated')
    expect(dated?.costUsd).toBe(2) // d2만(경계 07-10 포함), d1은 범위 밖

    const noFilter = folderRollup(db)
    expect(noFilter.find((r) => r.folder === 'dated')?.costUsd).toBe(3) // 필터 없으면 기존 동작 그대로
  })

  it('sessionsInFolder: from/to 기간 필터링', () => {
    upsertSessions(db, [
      {
        sessionId: 'e1',
        provider: 'claude',
        folder: 'dated2',
        startedAt: null,
        endedAt: '2026-06-01T00:00:00Z',
        totalTokens: 1,
        costUsd: 1
      },
      {
        sessionId: 'e2',
        provider: 'claude',
        folder: 'dated2',
        startedAt: null,
        endedAt: '2026-07-01T00:00:00Z', // to 경계값과 정확히 같은 날 — 포함돼야 함
        totalTokens: 1,
        costUsd: 1
      }
    ])

    const rows = sessionsInFolder(db, 'dated2', { from: '2026-07-01', to: '2026-07-31' })
    expect(rows.map((r) => r.sessionId)).toEqual(['e2'])
  })

  it('monthlyRollup: date를 substr(date,1,7)로 월별 그룹핑', () => {
    const rows = monthlyRollup(db)
    const july = rows.filter((r) => r.month === '2026-07')
    expect(july).toHaveLength(2) // claude/m1, codex/m2
    const june = rows.find((r) => r.month === '2026-06')
    expect(june).toMatchObject({ month: '2026-06', provider: 'claude', model: 'm1', costUsd: 1 })
  })

  it('snapshotSeries: provider+window+from 이후 값만 시간순으로 반환', () => {
    const rows = snapshotSeries(db, { provider: 'claude', window: 'weekly', from: 15 })
    expect(rows).toEqual([{ ts: 20, usedPercent: 20 }])

    const all = snapshotSeries(db, { provider: 'claude', window: 'weekly', from: 0 })
    expect(all).toEqual([
      { ts: 10, usedPercent: 10 },
      { ts: 20, usedPercent: 20 }
    ])
  })
})
