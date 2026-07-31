import { describe, it, expect } from 'vitest'
import claudeDaily from './__fixtures__/claude-daily.json'
import codexDaily from './__fixtures__/codex-daily.json'
import claudeSession from './__fixtures__/claude-session.json'
import codexSession from './__fixtures__/codex-session.json'
import { normalizeDaily, normalizeSessions } from './usage-normalizer'

describe('normalizeDaily', () => {
  it('claude: modelBreakdowns를 모델별 행으로 전개하고 cost 합계가 totalCost 합과 일치', () => {
    const rows = normalizeDaily('claude', claudeDaily)
    // 픽스처 3일: 4 + 2 + 3 모델 = 9행
    expect(rows).toHaveLength(9)
    expect(rows.every((r) => r.provider === 'claude')).toBe(true)
    const sum = rows.reduce((a, r) => a + r.costUsd, 0)
    const fixtureSum = claudeDaily.daily.reduce((a, d) => a + d.totalCost, 0)
    expect(sum).toBeCloseTo(fixtureSum, 4)
    expect(rows[0]).toEqual({
      date: '2026-07-09',
      provider: 'claude',
      model: 'claude-fable-5',
      inputTokens: 1000,
      outputTokens: 2000,
      cacheTokens: 5000 + 50000,
      costUsd: 1.5
    })
  })

  it('codex: 모델별 cost가 없으므로 전개 없이 하루 1행, cost = costUSD', () => {
    const rows = normalizeDaily('codex', codexDaily)
    // 픽스처 3일, 각 1모델 → 3행
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.provider === 'codex')).toBe(true)
    const sum = rows.reduce((a, r) => a + r.costUsd, 0)
    const fixtureSum = codexDaily.daily.reduce((a, d) => a + d.costUSD, 0)
    expect(sum).toBeCloseTo(fixtureSum, 4)
    expect(rows[0]).toEqual({
      date: '2026-07-08',
      provider: 'codex',
      model: 'gpt-5.5',
      inputTokens: 1000,
      outputTokens: 2000,
      cacheTokens: 0 + 50000,
      costUsd: 2.0
    })
  })
})

describe('normalizeSessions', () => {
  it('claude: projectPath→folder, firstActivity/lastActivity→startedAt/endedAt', () => {
    const rows = normalizeSessions('claude', claudeSession)
    expect(rows).toHaveLength(3)
    const sum = rows.reduce((a, r) => a + r.costUsd, 0)
    const fixtureSum = claudeSession.sessions.reduce((a, s) => a + s.totalCost, 0)
    expect(sum).toBeCloseTo(fixtureSum, 4)
    expect(rows[0]).toEqual({
      sessionId: '00000000-0000-4000-8000-000000000001',
      provider: 'claude',
      folder: 'D--Projects-DemoApp',
      startedAt: '2026-06-18T00:00:00.000Z',
      endedAt: '2026-06-18T00:00:00.000Z',
      totalTokens: 58000,
      costUsd: 1.5
    })
  })

  it('codex: 리졸버에 directory+sessionFile을 넘기고 결과를 folder로, startedAt은 null', () => {
    const rows = normalizeSessions(
      'codex',
      codexSession,
      (directory, sessionFile) => `${directory}|${sessionFile}`
    )
    expect(rows).toHaveLength(3)
    const sum = rows.reduce((a, r) => a + r.costUsd, 0)
    const fixtureSum = codexSession.sessions.reduce((a, s) => a + s.costUSD, 0)
    expect(sum).toBeCloseTo(fixtureSum, 4)
    // 리졸버가 받은 인자가 픽스처의 directory/sessionFile 그대로임을 folder로 검증
    expect(rows[0].folder).toBe(
      '2026/07/13|rollout-2026-07-13T00-00-00-00000000-0000-4000-8000-000000000011'
    )
    expect(rows[0]).toMatchObject({
      sessionId: '2026/07/13/rollout-2026-07-13T00-00-00-00000000-0000-4000-8000-000000000011',
      provider: 'codex',
      startedAt: null,
      endedAt: '2026-07-13T00:00:00.000Z',
      totalTokens: 53000
    })
    expect(rows[0].costUsd).toBeCloseTo(2.0, 6)
  })

  it('codex: 리졸버 미지정 또는 null 반환 시 folder는 (폴더 미지정)', () => {
    const noResolver = normalizeSessions('codex', codexSession)
    expect(noResolver.every((r) => r.folder === '(폴더 미지정)')).toBe(true)
    const nullResolver = normalizeSessions('codex', codexSession, () => null)
    expect(nullResolver.every((r) => r.folder === '(폴더 미지정)')).toBe(true)
  })
})
