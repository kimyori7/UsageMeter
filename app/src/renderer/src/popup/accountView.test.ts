import { describe, expect, it } from 'vitest'
import { displayWindow, isDimmed, SNAPSHOT_GRACE_MS } from './accountView'

const w = (resetsAt: number): { kind: 'weekly'; usedPercent: number; resetsAt: number } => ({
  kind: 'weekly',
  usedPercent: 80,
  resetsAt
})

describe('displayWindow', () => {
  it('live 창은 리셋 시각이 지나도 resetPassed=false(서버 수치 그대로)', () => {
    expect(displayWindow(w(100), 200, true).resetPassed).toBe(false)
  })
  it('스냅샷 창: 리셋 지남 → true(경계 포함), 미래 → false', () => {
    expect(displayWindow(w(100), 200, false).resetPassed).toBe(true)
    expect(displayWindow(w(200), 200, false).resetPassed).toBe(true)
    expect(displayWindow(w(300), 200, false).resetPassed).toBe(false)
  })
  it('resetsAt=0(미상)·null 창은 false', () => {
    expect(displayWindow(w(0), 200, false).resetPassed).toBe(false)
    expect(displayWindow(null, 200, false)).toEqual({ window: null, resetPassed: false })
  })
})

describe('isDimmed', () => {
  it('live 카드는 아무리 오래돼도 흐리지 않는다', () => {
    expect(isDimmed(true, 0, Number.MAX_SAFE_INTEGER)).toBe(false)
  })
  it('마지막 성공 후 유예(10분) 안이면 흐리지 않는다', () => {
    const T = 1_000_000
    expect(isDimmed(false, T, T + SNAPSHOT_GRACE_MS - 1)).toBe(false)
  })
  it('경계: 정확히 유예(10분)가 지나면 흐려진다', () => {
    const T = 1_000_000
    expect(isDimmed(false, T, T + SNAPSHOT_GRACE_MS)).toBe(true)
  })
})
