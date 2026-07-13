// 대시보드 기간 계산 순수함수. 모든 날짜는 로컬 캘린더 기준(YYYY-MM-DD) — 표시용 문자열이지
// epoch가 아니다. dailyTotals(from/to)에 그대로 넘기는 문자열을 여기서 만든다.
export type Period = '7d' | '30d' | '90d' | 'all'

export interface DateRange {
  from?: string
  to?: string
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** 오늘을 포함해 최근 n일 범위. n=7이면 오늘 기준 6일 전 ~ 오늘. */
export function lastNDaysRange(n: number, today: Date = new Date()): DateRange {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1))
  return { from: toIsoDate(from), to: toIsoDate(today) }
}

/** 기간 칩(7/30/90일/전체) 선택값을 dailyTotals용 {from,to}로 변환. 'all'은 경계 없음. */
export function periodRange(period: Period, today: Date = new Date()): DateRange {
  if (period === 'all') return {}
  const days = { '7d': 7, '30d': 30, '90d': 90 }[period]
  return lastNDaysRange(days, today)
}

/** 이번 달 접두사 'YYYY-MM' — monthlyRollup 행의 month 필드와 직접 비교한다. */
export function currentMonthPrefix(today: Date = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}
