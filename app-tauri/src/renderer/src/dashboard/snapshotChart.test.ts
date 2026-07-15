import { describe, it, expect } from 'vitest'
import { mergeSnapshotSeries, type SnapshotSeriesInput } from './snapshotChart'

describe('mergeSnapshotSeries', () => {
  it('provider×window 4계열을 ts 하나당 한 행으로 병합', () => {
    const inputs: SnapshotSeriesInput[] = [
      {
        provider: 'claude',
        window: 'session_5h',
        rows: [
          { ts: 100, usedPercent: 10 },
          { ts: 200, usedPercent: 20 }
        ]
      },
      {
        provider: 'claude',
        window: 'weekly',
        rows: [{ ts: 100, usedPercent: 30 }]
      },
      {
        provider: 'codex',
        window: 'session_5h',
        rows: [{ ts: 150, usedPercent: 40 }]
      },
      {
        provider: 'codex',
        window: 'weekly',
        rows: []
      }
    ]

    expect(mergeSnapshotSeries(inputs)).toEqual([
      { ts: 100, claudeSession: 10, claudeWeekly: 30, codexSession: null, codexWeekly: null },
      { ts: 150, claudeSession: null, claudeWeekly: null, codexSession: 40, codexWeekly: null },
      { ts: 200, claudeSession: 20, claudeWeekly: null, codexSession: null, codexWeekly: null }
    ])
  })

  it('빈 입력은 빈 배열', () => {
    expect(mergeSnapshotSeries([])).toEqual([])
  })

  it('모든 series의 rows가 비어 있으면 빈 배열', () => {
    const inputs: SnapshotSeriesInput[] = [
      { provider: 'claude', window: 'session_5h', rows: [] },
      { provider: 'codex', window: 'weekly', rows: [] }
    ]
    expect(mergeSnapshotSeries(inputs)).toEqual([])
  })

  it('ts 오름차순 정렬(입력 순서가 뒤섞여 있어도)', () => {
    const inputs: SnapshotSeriesInput[] = [
      {
        provider: 'claude',
        window: 'session_5h',
        rows: [
          { ts: 300, usedPercent: 1 },
          { ts: 100, usedPercent: 2 },
          { ts: 200, usedPercent: 3 }
        ]
      }
    ]
    expect(mergeSnapshotSeries(inputs).map((p) => p.ts)).toEqual([100, 200, 300])
  })

  it('같은 provider의 session/weekly가 같은 ts에 값을 가지면 한 행에 함께 기록', () => {
    const inputs: SnapshotSeriesInput[] = [
      { provider: 'codex', window: 'session_5h', rows: [{ ts: 500, usedPercent: 55 }] },
      { provider: 'codex', window: 'weekly', rows: [{ ts: 500, usedPercent: 66 }] }
    ]
    expect(mergeSnapshotSeries(inputs)).toEqual([
      { ts: 500, claudeSession: null, claudeWeekly: null, codexSession: 55, codexWeekly: 66 }
    ])
  })
})
