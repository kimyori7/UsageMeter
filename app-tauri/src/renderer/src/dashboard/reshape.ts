// dailyTotals(query:daily) 원시 행(날짜×provider 각각 한 행)을 Recharts/표가 바로 쓸 수 있는
// "날짜 하나당 한 행" 형태로 피벗한다. 없는 provider는 0으로 채운다(스택 차트가 구멍 없이 그려지도록).
import type { ProviderId } from '../../../providers/types'

interface DailyTotalRow {
  date: string
  provider: ProviderId
  costUsd: number
  totalTokens: number
}

export interface PivotedDailyRow {
  date: string
  claudeCost: number
  claudeTokens: number
  codexCost: number
  codexTokens: number
}

export function pivotDaily(rows: DailyTotalRow[]): PivotedDailyRow[] {
  const byDate = new Map<string, PivotedDailyRow>()
  for (const row of rows) {
    const existing = byDate.get(row.date) ?? {
      date: row.date,
      claudeCost: 0,
      claudeTokens: 0,
      codexCost: 0,
      codexTokens: 0
    }
    if (row.provider === 'claude') {
      existing.claudeCost = row.costUsd
      existing.claudeTokens = row.totalTokens
    } else {
      existing.codexCost = row.costUsd
      existing.codexTokens = row.totalTokens
    }
    byDate.set(row.date, existing)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
