import { describe, it, expect } from 'vitest'
import { pivotDaily } from './reshape'
import type { ProviderId } from '../../../providers/types'

interface DailyTotalRow {
  date: string
  provider: ProviderId
  costUsd: number
  totalTokens: number
}

describe('pivotDaily', () => {
  it('provider별 행을 날짜 하나당 한 행(claude/codex 필드)으로 피벗', () => {
    const rows: DailyTotalRow[] = [
      { date: '2026-07-01', provider: 'claude', costUsd: 1, totalTokens: 100 },
      { date: '2026-07-01', provider: 'codex', costUsd: 2, totalTokens: 200 },
      { date: '2026-07-02', provider: 'claude', costUsd: 3, totalTokens: 300 }
    ]
    expect(pivotDaily(rows)).toEqual([
      { date: '2026-07-01', claudeCost: 1, claudeTokens: 100, codexCost: 2, codexTokens: 200 },
      { date: '2026-07-02', claudeCost: 3, claudeTokens: 300, codexCost: 0, codexTokens: 0 }
    ])
  })

  it('빈 입력은 빈 배열', () => {
    expect(pivotDaily([])).toEqual([])
  })

  it('날짜 오름차순으로 정렬', () => {
    const rows: DailyTotalRow[] = [
      { date: '2026-07-02', provider: 'claude', costUsd: 1, totalTokens: 1 },
      { date: '2026-07-01', provider: 'claude', costUsd: 2, totalTokens: 2 }
    ]
    expect(pivotDaily(rows).map((r) => r.date)).toEqual(['2026-07-01', '2026-07-02'])
  })
})
