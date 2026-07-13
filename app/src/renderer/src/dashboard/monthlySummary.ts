// monthlyRollup(provider×model×month) 원시 행을 월 리포트 탭의 카드 리스트로 집계한다.
// monthlyRollup은 opts를 받지 않으므로(queries.ts 계약) provider 토글 필터는 여기서 처리한다.
import type { ProviderId } from '../../../providers/types'

interface MonthlyRollupRow {
  month: string // 'YYYY-MM'
  provider: ProviderId
  model: string
  costUsd: number
  totalTokens: number
}

export interface MonthCard {
  month: string
  totalCost: number
  totalTokens: number
  breakdown: Array<{ provider: ProviderId; model: string; costUsd: number; totalTokens: number }>
  // 직전 캘린더 월 데이터가 없거나 그 달 비용이 0이면 null(무한대 방지) — "N/A" 표시용.
  pctChangeVsPrevMonth: number | null
}

/** 'YYYY-MM' → 정확히 한 달 전의 'YYYY-MM' (연도 경계 포함). */
function previousMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const prevMonthIndex = m - 1 - 1 // 0-based, 한 달 전
  const d = new Date(y, prevMonthIndex, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function summarizeMonths(rows: MonthlyRollupRow[], providers?: ProviderId[]): MonthCard[] {
  const filtered =
    providers && providers.length > 0 ? rows.filter((r) => providers.includes(r.provider)) : rows

  const byMonth = new Map<string, MonthCard>()
  for (const row of filtered) {
    const card = byMonth.get(row.month) ?? {
      month: row.month,
      totalCost: 0,
      totalTokens: 0,
      breakdown: [],
      pctChangeVsPrevMonth: null
    }
    card.totalCost += row.costUsd
    card.totalTokens += row.totalTokens
    card.breakdown.push({
      provider: row.provider,
      model: row.model,
      costUsd: row.costUsd,
      totalTokens: row.totalTokens
    })
    byMonth.set(row.month, card)
  }

  for (const card of byMonth.values()) {
    card.breakdown.sort((a, b) => b.costUsd - a.costUsd)
    const prev = byMonth.get(previousMonthKey(card.month))
    card.pctChangeVsPrevMonth =
      prev && prev.totalCost > 0 ? ((card.totalCost - prev.totalCost) / prev.totalCost) * 100 : null
  }

  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month))
}
