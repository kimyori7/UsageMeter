// 한도 소진 추이 차트 — 개요 탭 하단, snapshotChart.ts(mergeSnapshotSeries)가 만든 ts 하나당 한 행짜리
// 데이터를 Recharts LineChart로 그린다. UsageChart.tsx와 동일한 팔레트(Claude #d97757/Codex #19c37d)를
// 쓰되, 여기선 색만으로 session/weekly를 구분하지 않도록 실선(session)/점선(weekly)으로 이중 부호화
// (secondary encoding)한다. provider×window 4계열 중 실제 값이 있는 계열만 그린다(데이터 없는 계열이
// 범례에 빈 항목으로 뜨거나 축을 왜곡하지 않도록). 90%는 popup/format.ts의 WARN_PERCENT와 같은 임계값
// — 두 곳에서 숫자가 어긋나지 않도록 주석으로 짝을 명시해 둔다(상수 자체는 import하기엔 팝업 전용 모듈이라
// 과한 결합이라 판단, 값만 맞춤).
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { SnapshotChartPoint } from '../dashboard/snapshotChart'

interface SnapshotChartProps {
  data: SnapshotChartPoint[]
}

type SeriesKey = Exclude<keyof SnapshotChartPoint, 'ts'>

const SERIES: Array<{ key: SeriesKey; name: string; color: string; dashed: boolean }> = [
  { key: 'claudeSession', name: 'Claude 세션', color: '#d97757', dashed: false },
  { key: 'claudeWeekly', name: 'Claude 주간', color: '#d97757', dashed: true },
  { key: 'codexSession', name: 'Codex 세션', color: '#19c37d', dashed: false },
  { key: 'codexWeekly', name: 'Codex 주간', color: '#19c37d', dashed: true }
]

function fmtTick(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${min}`
}

function ChartTooltip({ active, payload, label }: TooltipContentProps): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{fmtTick(Number(label))}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="chart-tooltip-row">
          <span
            className={`chart-tooltip-dot chart-tooltip-dot--${String(entry.dataKey).startsWith('claude') ? 'claude' : 'codex'}`}
          />
          <span>{entry.name}</span>
          <b>
            {entry.value === null || entry.value === undefined
              ? '—'
              : `${Math.round(Number(entry.value))}%`}
          </b>
        </div>
      ))}
    </div>
  )
}

export default function SnapshotChart({ data }: SnapshotChartProps): React.JSX.Element {
  if (data.length === 0) {
    return <div className="chart-empty">표시할 데이터가 없습니다.</div>
  }

  const visibleSeries = SERIES.filter((s) => data.some((p) => p[s.key] !== null))

  return (
    <div className="usage-chart">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#2a2a38" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            scale="time"
            tick={{ fill: '#8b8b9e', fontSize: 10 }}
            axisLine={{ stroke: '#2a2a38' }}
            tickLine={false}
            tickFormatter={fmtTick}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: '#8b8b9e', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            content={(props) => <ChartTooltip {...props} />}
            cursor={{ stroke: '#3a3a4e' }}
            isAnimationActive={false}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#8b8b9e' }} />
          {/* 90%: popup/format.ts WARN_PERCENT와 동일한 임계값(경고색 전환 지점). */}
          <ReferenceLine y={90} stroke="#e0a030" strokeDasharray="4 4" ifOverflow="extendDomain" />
          {visibleSeries.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeDasharray={s.dashed ? '5 5' : undefined}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
