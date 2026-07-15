// 월 리포트 탭: monthlyRollup을 월 카드 리스트로(월 합계 / 프로바이더×모델 내역 표 / 전월 대비 ±%).
// 필터 바가 없다(Dashboard.tsx 주석 참고) — 항상 전체 프로바이더 기준.
import { useEffect, useState } from 'react'
import { queryMonthly } from '../api'
import { summarizeMonths, type MonthCard } from './monthlySummary'
import { fmtMoney, fmtTokens } from '../popup/format'
import type { ProviderId } from '../../../providers/types'

const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex' }

function fmtPctChange(pct: number | null): string {
  if (pct === null) return '전월 데이터 없음'
  const sign = pct > 0 ? '+' : ''
  return `전월 대비 ${sign}${pct.toFixed(1)}%`
}

export default function MonthlyTab(): React.JSX.Element {
  const [cards, setCards] = useState<MonthCard[]>([])

  useEffect(() => {
    let cancelled = false
    queryMonthly().then((rows) => {
      if (!cancelled) setCards(summarizeMonths(rows))
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (cards.length === 0) {
    return <div className="monthly-empty">표시할 월별 데이터가 없습니다.</div>
  }

  return (
    <div className="monthly-tab">
      {cards.map((card) => (
        <div key={card.month} className="month-card">
          <div className="month-card-header">
            <span className="month-card-title">{card.month}</span>
            <span className="month-card-total">
              {fmtMoney(card.totalCost)} · {fmtTokens(card.totalTokens)}
            </span>
            <span
              className={`month-card-change${
                card.pctChangeVsPrevMonth === null
                  ? ''
                  : card.pctChangeVsPrevMonth >= 0
                    ? ' month-card-change--up'
                    : ' month-card-change--down'
              }`}
            >
              {fmtPctChange(card.pctChangeVsPrevMonth)}
            </span>
          </div>
          <table className="month-table">
            <thead>
              <tr>
                <th>프로바이더</th>
                <th>모델</th>
                <th>비용</th>
                <th>토큰</th>
              </tr>
            </thead>
            <tbody>
              {card.breakdown.map((b, i) => (
                <tr key={`${b.provider}-${b.model}-${i}`}>
                  <td>
                    <span className={`provider-dot provider-dot--${b.provider}`} />{' '}
                    {PROVIDER_LABEL[b.provider]}
                  </td>
                  <td>{b.model || '—'}</td>
                  <td>{fmtMoney(b.costUsd)}</td>
                  <td>{fmtTokens(b.totalTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
