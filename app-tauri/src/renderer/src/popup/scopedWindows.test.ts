import { describe, expect, it } from 'vitest'
import { scopedModelName, scopedWeeklyWindows, scopedWindowLabel } from './scopedWindows'
import type { RateWindow } from '../../../providers/types'

const w = (kind: RateWindow['kind']): RateWindow => ({ kind, usedPercent: 1, resetsAt: 0 })

describe('scopedWeeklyWindows', () => {
  it('weekly_ 접두사 창만 고르고 session_5h/weekly는 제외한다', () => {
    const windows = [w('session_5h'), w('weekly'), w('weekly_fable'), w('weekly_opus_4_5')]
    expect(scopedWeeklyWindows(windows).map((x) => x.kind)).toEqual([
      'weekly_fable',
      'weekly_opus_4_5'
    ])
  })

  it('스코프 창이 없으면 빈 배열', () => {
    expect(scopedWeeklyWindows([w('session_5h'), w('weekly')])).toEqual([])
  })
})

describe('scopedModelName / scopedWindowLabel', () => {
  it('모델명 슬러그를 대문자화해 이름·라벨을 만든다', () => {
    expect(scopedModelName('weekly_fable')).toBe('Fable')
    expect(scopedModelName('weekly_opus_4_5')).toBe('Opus 4 5')
    expect(scopedWindowLabel('weekly_fable')).toBe('주간 한도 (Fable)')
  })
})
