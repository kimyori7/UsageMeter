// 개요 탭: StatCard 3개(이번 주 비용 / 주간 한도 %×선택된 프로바이더 / 이번 달 누적) + 일별 비용
// 스택 차트(UsageChart, dataviz 스킬 적용은 UsageChart.tsx 쪽 주석 참고). "이번 주 비용"은 기간 칩과
// 무관하게 항상 최근 7일 고정(design doc §6.1 요약 카드는 기간 칩의 대상이 아니다) — 차트만 기간 칩을 따른다.
import { useEffect, useState } from 'react'
import StatCard from '../components/StatCard'
import UsageChart from '../components/UsageChart'
import SnapshotChart from '../components/SnapshotChart'
import { queryDaily, queryMonthly, querySnapshots, useAppState } from '../api'
import { pivotDaily, type PivotedDailyRow } from './reshape'
import { mergeSnapshotSeries, type SnapshotChartPoint } from './snapshotChart'
import {
  currentMonthPrefix,
  lastNDaysRange,
  periodFromMs,
  periodRange,
  type Period
} from './period'
import { displayPercent, fmtMoney } from '../popup/format'
import type { ProviderId, WindowKind } from '../../../providers/types'

interface OverviewTabProps {
  period: Period
  providers: ProviderId[]
}

const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex' }
const WINDOW_KINDS: WindowKind[] = ['session_5h', 'weekly']

export default function OverviewTab({ period, providers }: OverviewTabProps): React.JSX.Element {
  const appState = useAppState()
  const [weekCost, setWeekCost] = useState<number | null>(null)
  const [monthCost, setMonthCost] = useState<number | null>(null)
  const [chartRows, setChartRows] = useState<PivotedDailyRow[]>([])
  const [snapshotPoints, setSnapshotPoints] = useState<SnapshotChartPoint[]>([])

  useEffect(() => {
    let cancelled = false
    const weekRange = lastNDaysRange(7)
    const chartRange = periodRange(period)
    const monthPrefix = currentMonthPrefix()

    Promise.all([
      queryDaily({ ...weekRange, providers }),
      queryDaily({ ...chartRange, providers }),
      queryMonthly()
    ]).then(([weekRows, rawChartRows, monthlyRows]) => {
      if (cancelled) return
      setWeekCost(weekRows.reduce((sum, r) => sum + r.costUsd, 0))
      setChartRows(pivotDaily(rawChartRows))
      setMonthCost(
        monthlyRows
          .filter((r) => r.month === monthPrefix && providers.includes(r.provider))
          .reduce((sum, r) => sum + r.costUsd, 0)
      )
    })

    return () => {
      cancelled = true
    }
  }, [period, providers])

  // 한도 소진 추이 — 선택된 프로바이더 × session/weekly 조합만 조회(꺼진 프로바이더는 쿼리 자체를 안 보냄).
  useEffect(() => {
    let cancelled = false
    const from = periodFromMs(period)
    const targets = providers.flatMap((provider) =>
      WINDOW_KINDS.map((window) => ({ provider, window }))
    )

    Promise.all(
      targets.map(({ provider, window }) =>
        querySnapshots({ provider, window, from }).then((rows) => ({ provider, window, rows }))
      )
    ).then((series) => {
      if (!cancelled) setSnapshotPoints(mergeSnapshotSeries(series))
    })

    return () => {
      cancelled = true
    }
  }, [period, providers])

  return (
    <div className="overview-tab">
      <div className="stat-cards">
        <StatCard label="이번 주 비용">
          <div className="stat-value">{weekCost === null ? '…' : fmtMoney(weekCost)}</div>
        </StatCard>

        <StatCard label="주간 한도">
          {providers.map((p) => {
            const weekly = appState?.limits[p]?.windows.find((w) => w.kind === 'weekly') ?? null
            return (
              <div key={p} className="stat-provider-row">
                <span className={`provider-dot provider-dot--${p}`} />
                <span>{PROVIDER_LABEL[p]}</span>
                <b>{weekly ? `${displayPercent(weekly.usedPercent)}%` : '—'}</b>
              </div>
            )
          })}
        </StatCard>

        <StatCard label="이번 달 누적">
          <div className="stat-value">{monthCost === null ? '…' : fmtMoney(monthCost)}</div>
        </StatCard>
      </div>

      <UsageChart data={chartRows} metric="cost" />

      <div className="overview-section-title">한도 소진 추이</div>
      <SnapshotChart data={snapshotPoints} />
    </div>
  )
}
