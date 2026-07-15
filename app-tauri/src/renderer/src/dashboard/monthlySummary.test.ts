import { describe, it, expect } from 'vitest'
import { summarizeMonths } from './monthlySummary'
import type { ProviderId } from '../../../providers/types'

interface MonthlyRollupRow {
  month: string
  provider: ProviderId
  model: string
  costUsd: number
  totalTokens: number
}

const ROWS: MonthlyRollupRow[] = [
  { month: '2026-06', provider: 'claude', model: 'sonnet', costUsd: 10, totalTokens: 1000 },
  { month: '2026-07', provider: 'claude', model: 'sonnet', costUsd: 15, totalTokens: 1500 },
  { month: '2026-07', provider: 'codex', model: 'gpt', costUsd: 5, totalTokens: 500 }
]

describe('summarizeMonths', () => {
  it('월별 합계 + 모델별 내역(비용 내림차순) + 전월 대비 %를 계산, 최신 월이 먼저', () => {
    const cards = summarizeMonths(ROWS)
    expect(cards.map((c) => c.month)).toEqual(['2026-07', '2026-06'])

    const july = cards[0]
    expect(july.totalCost).toBe(20)
    expect(july.totalTokens).toBe(2000)
    expect(july.breakdown).toEqual([
      { provider: 'claude', model: 'sonnet', costUsd: 15, totalTokens: 1500 },
      { provider: 'codex', model: 'gpt', costUsd: 5, totalTokens: 500 }
    ])
    // (20 - 10) / 10 * 100 = 100
    expect(july.pctChangeVsPrevMonth).toBe(100)

    const june = cards[1]
    expect(june.pctChangeVsPrevMonth).toBeNull() // 이전 달(2026-05) 데이터 없음
  })

  it('providers 필터 지정 시 해당 provider 행만 집계', () => {
    const cards = summarizeMonths(ROWS, ['claude'])
    const july = cards.find((c) => c.month === '2026-07')!
    expect(july.totalCost).toBe(15)
    expect(july.breakdown).toEqual([
      { provider: 'claude', model: 'sonnet', costUsd: 15, totalTokens: 1500 }
    ])
  })

  it('직전 달이 데이터에 존재하지 않으면(연속되지 않음) null', () => {
    const rows: MonthlyRollupRow[] = [
      { month: '2026-05', provider: 'claude', model: 'm', costUsd: 1, totalTokens: 1 },
      { month: '2026-07', provider: 'claude', model: 'm', costUsd: 2, totalTokens: 2 }
    ]
    const july = summarizeMonths(rows).find((c) => c.month === '2026-07')!
    expect(july.pctChangeVsPrevMonth).toBeNull()
  })

  it('직전 달 비용이 0이면 무한대 대신 null', () => {
    const rows: MonthlyRollupRow[] = [
      { month: '2026-06', provider: 'claude', model: 'm', costUsd: 0, totalTokens: 5 },
      { month: '2026-07', provider: 'claude', model: 'm', costUsd: 3, totalTokens: 3 }
    ]
    const july = summarizeMonths(rows).find((c) => c.month === '2026-07')!
    expect(july.pctChangeVsPrevMonth).toBeNull()
  })

  it('연도 경계(1월 → 전년 12월)도 정확히 조회', () => {
    const rows: MonthlyRollupRow[] = [
      { month: '2025-12', provider: 'claude', model: 'm', costUsd: 10, totalTokens: 1 },
      { month: '2026-01', provider: 'claude', model: 'm', costUsd: 5, totalTokens: 1 }
    ]
    const jan = summarizeMonths(rows).find((c) => c.month === '2026-01')!
    expect(jan.pctChangeVsPrevMonth).toBe(-50)
  })

  it('빈 입력은 빈 배열', () => {
    expect(summarizeMonths([])).toEqual([])
  })
})
