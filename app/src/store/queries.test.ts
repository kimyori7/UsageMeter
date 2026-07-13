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

  // from/to는 로컬 캘린더 일 기준이다 — 기대값은 KST 등 특정 tz를 하드코딩하지 않고, 테스트가 도는
  // 환경의 tz로 UTC 타임스탬프를 JS Date 로컬 게터로 변환해(아래 localDay) 도출한다. 그래야 어느
  // 머신에서든 통과하면서, SQL 쪽이 UTC 일을 추출하는 버그(로컬 일 ≠ UTC 일인 시각대)에선 실패한다.
  function localDay(iso: string): string {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`
  }
  function shiftDay(day: string, delta: number): string {
    const [y, m, dd] = day.split('-').map(Number)
    const d = new Date(y, m - 1, dd + delta)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`
  }

  it('folderRollup: from/to로 세션 종료일(ended_at, 로컬 일) 기준 기간 필터링(양끝 포함)', () => {
    const d1End = '2026-07-01T10:00:00Z'
    const d2End = '2026-07-10T23:59:00Z'
    upsertSessions(db, [
      {
        sessionId: 'd1',
        provider: 'claude',
        folder: 'dated',
        startedAt: null,
        endedAt: d1End,
        totalTokens: 10,
        costUsd: 1
      },
      {
        sessionId: 'd2',
        provider: 'claude',
        folder: 'dated',
        startedAt: null,
        endedAt: d2End,
        totalTokens: 20,
        costUsd: 2
      }
    ])

    const d2Only = folderRollup(db, { from: localDay(d2End), to: localDay(d2End) })
    expect(d2Only.find((r) => r.folder === 'dated')?.costUsd).toBe(2)

    const d1Only = folderRollup(db, { from: localDay(d1End), to: localDay(d1End) })
    expect(d1Only.find((r) => r.folder === 'dated')?.costUsd).toBe(1)

    const noFilter = folderRollup(db)
    expect(noFilter.find((r) => r.folder === 'dated')?.costUsd).toBe(3) // 필터 없으면 기존 동작 그대로
  })

  it('sessionsInFolder: from/to 기간 필터링', () => {
    const e1End = '2026-06-01T12:00:00Z'
    const e2End = '2026-07-01T12:00:00Z'
    upsertSessions(db, [
      {
        sessionId: 'e1',
        provider: 'claude',
        folder: 'dated2',
        startedAt: null,
        endedAt: e1End,
        totalTokens: 1,
        costUsd: 1
      },
      {
        sessionId: 'e2',
        provider: 'claude',
        folder: 'dated2',
        startedAt: null,
        endedAt: e2End, // from 경계값과 정확히 같은 날 — 포함돼야 함
        totalTokens: 1,
        costUsd: 1
      }
    ])

    const rows = sessionsInFolder(db, 'dated2', { from: localDay(e2End), to: localDay(e2End) })
    expect(rows.map((r) => r.sessionId)).toEqual(['e2'])
  })

  it('from/to는 로컬 캘린더 일 기준 — UTC 일과 로컬 일이 다른 시각의 세션도 로컬 일 창에 잡힌다', () => {
    // 20:00Z: UTC+5 이상(KST 포함)에선 로컬 일이 UTC 일의 다음 날이 되는 시각.
    // 음수 오프셋/UTC 머신에선 로컬 일 == UTC 일이지만, 아래 단언은 어느 쪽에서든 성립한다
    // (로컬 일 창에 포함 + 앞뒤 날 창에서 제외 — SQL이 UTC 일을 추출하면 KST류 머신에서 실패).
    const boundaryEnd = '2026-07-09T20:00:00Z'
    upsertSessions(db, [
      {
        sessionId: 'tz1',
        provider: 'claude',
        folder: 'tzcheck',
        startedAt: null,
        endedAt: boundaryEnd,
        totalTokens: 1,
        costUsd: 1
      }
    ])
    const day = localDay(boundaryEnd)

    const hit = sessionsInFolder(db, 'tzcheck', { from: day, to: day })
    expect(hit.map((r) => r.sessionId)).toEqual(['tz1'])

    const prevDay = shiftDay(day, -1)
    expect(sessionsInFolder(db, 'tzcheck', { from: prevDay, to: prevDay })).toEqual([])
    const nextDay = shiftDay(day, 1)
    expect(sessionsInFolder(db, 'tzcheck', { from: nextDay, to: nextDay })).toEqual([])

    const rollupHit = folderRollup(db, { from: day, to: day })
    expect(rollupHit.find((r) => r.folder === 'tzcheck')?.costUsd).toBe(1)
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
