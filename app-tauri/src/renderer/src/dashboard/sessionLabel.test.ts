import { describe, it, expect } from 'vitest'
import { sessionLabel } from './sessionLabel'

describe('sessionLabel', () => {
  it('startedAt이 있으면 M/D HH:MM 형식 + sessionId 앞 8자', () => {
    const iso = new Date(2026, 6, 13, 14, 33).toISOString()
    expect(sessionLabel({ startedAt: iso, endedAt: null, sessionId: 'abcdefgh12345' })).toBe(
      '7/13 14:33 · abcdefgh'
    )
  })

  it('startedAt이 없으면 endedAt 사용(codex는 startedAt이 항상 null)', () => {
    const iso = new Date(2026, 6, 13, 10, 14).toISOString()
    expect(sessionLabel({ startedAt: null, endedAt: iso, sessionId: 'rollout-f5' })).toBe(
      '7/13 10:14 · rollout-'
    )
  })

  it('둘 다 없으면 "(시각 미상)"', () => {
    expect(sessionLabel({ startedAt: null, endedAt: null, sessionId: 'xyz' })).toBe(
      '(시각 미상) · xyz'
    )
  })

  it('한 자리 시/분/월/일도 두 자리로 패딩', () => {
    const iso = new Date(2026, 0, 5, 9, 5).toISOString()
    expect(sessionLabel({ startedAt: iso, endedAt: null, sessionId: 'abcdefgh' })).toBe(
      '1/5 09:05 · abcdefgh'
    )
  })
})
