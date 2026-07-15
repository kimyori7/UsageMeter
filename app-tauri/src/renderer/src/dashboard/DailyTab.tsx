// 일별 기록 탭: 날짜별 프로바이더별 비용·토큰 표 + 토큰 스택 차트. 기간 칩은 셸에서 공유(Overview와 동일 API).
import { useEffect, useState } from 'react'
import UsageChart from '../components/UsageChart'
import { queryDaily } from '../api'
import { pivotDaily, type PivotedDailyRow } from './reshape'
import { periodRange, type Period } from './period'
import { fmtMoney, fmtTokens } from '../popup/format'
import type { ProviderId } from '../../../providers/types'

interface DailyTabProps {
  period: Period
  providers: ProviderId[]
}

export default function DailyTab({ period, providers }: DailyTabProps): React.JSX.Element {
  const [rows, setRows] = useState<PivotedDailyRow[]>([])

  useEffect(() => {
    let cancelled = false
    const range = periodRange(period)
    queryDaily({ ...range, providers }).then((raw) => {
      if (!cancelled) setRows(pivotDaily(raw))
    })
    return () => {
      cancelled = true
    }
  }, [period, providers])

  const showClaude = providers.includes('claude')
  const showCodex = providers.includes('codex')

  return (
    <div className="daily-tab">
      <UsageChart data={rows} metric="tokens" />

      <div className="daily-table-wrap">
        <table className="daily-table">
          <thead>
            <tr>
              <th rowSpan={2}>날짜</th>
              {showClaude && <th colSpan={2}>Claude</th>}
              {showCodex && <th colSpan={2}>Codex</th>}
              <th rowSpan={2}>합계</th>
            </tr>
            <tr>
              {showClaude && (
                <>
                  <th>비용</th>
                  <th>토큰</th>
                </>
              )}
              {showCodex && (
                <>
                  <th>비용</th>
                  <th>토큰</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="daily-table-empty">
                  표시할 데이터가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.date}>
                <td>{row.date}</td>
                {showClaude && (
                  <>
                    <td>{fmtMoney(row.claudeCost)}</td>
                    <td>{fmtTokens(row.claudeTokens)}</td>
                  </>
                )}
                {showCodex && (
                  <>
                    <td>{fmtMoney(row.codexCost)}</td>
                    <td>{fmtTokens(row.codexTokens)}</td>
                  </>
                )}
                <td>
                  <b>{fmtMoney(row.claudeCost + row.codexCost)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
