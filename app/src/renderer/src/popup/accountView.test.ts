import { describe, expect, it } from 'vitest'
import { displayWindow } from './accountView'

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
