// 일별 비용/토큰 스택 막대 차트 — 개요 탭(비용)과 일별 기록 탭(토큰)이 공유한다.
// dataviz 스킬 적용: 카테고리(프로바이더) 순서 고정(Claude→Codex, 절대 순환하지 않음), 2개 시리즈라
// 범례 항상 노출, 스택 세그먼트 사이는 배경색 stroke로 2px 틈을 내 시각적으로 분리, 축/그리드는
// 옅은 색으로 절제, 툴팁은 hover 시 날짜별 값을 popup/format.ts의 동일한 포맷터로 표시(단위 일관성).
// 색은 확정 브랜드 컬러(Claude #d97757/Codex #19c37d)라 팔레트 재계산 대상이 아니다 — 다만 validator로
// 다크 배경 대비 대비/CVD 분리를 확인했고(밝기 밴드만 벗어남, CVD·대비는 통과) 그 보완으로 범례 +
// 툴팁 직접 라벨을 항상 켜 둔다(색만으로 구분하지 않도록, secondary encoding).
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { fmtMoney, fmtTokens } from '../popup/format'
import type { PivotedDailyRow } from '../dashboard/reshape'

export type UsageMetric = 'cost' | 'tokens'

interface UsageChartProps {
  data: PivotedDailyRow[]
  metric: UsageMetric
}

const METRIC_KEYS: Record<UsageMetric, { claude: string; codex: string }> = {
  cost: { claude: 'claudeCost', codex: 'codexCost' },
  tokens: { claude: 'claudeTokens', codex: 'codexTokens' }
}

function fmtValue(metric: UsageMetric, n: number): string {
  return metric === 'cost' ? fmtMoney(n) : fmtTokens(n)
}

function ChartTooltip({
  active,
  payload,
  label,
  metric
}: TooltipContentProps & { metric: UsageMetric }): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{label}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="chart-tooltip-row">
          <span
            className={`chart-tooltip-dot chart-tooltip-dot--${String(entry.dataKey).startsWith('claude') ? 'claude' : 'codex'}`}
          />
          <span>{entry.name}</span>
          <b>{fmtValue(metric, Number(entry.value ?? 0))}</b>
        </div>
      ))}
    </div>
  )
}

export default function UsageChart({ data, metric }: UsageChartProps): React.JSX.Element {
  const keys = METRIC_KEYS[metric]

  if (data.length === 0) {
    return <div className="chart-empty">표시할 데이터가 없습니다.</div>
  }

  return (
    <div className="usage-chart">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid vertical={false} stroke="#2a2a38" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#8b8b9e', fontSize: 10 }}
            axisLine={{ stroke: '#2a2a38' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#8b8b9e', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v: number) => fmtValue(metric, v)}
          />
          <Tooltip
            content={(props) => <ChartTooltip {...props} metric={metric} />}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#8b8b9e' }} />
          {/* 스택 순서 고정: Claude(바닥, 밑면=축과 맞닿아 각지게)→Codex(꼭대기, 바깥쪽 끝만 둥글게). */}
          <Bar
            dataKey={keys.claude}
            name="Claude"
            stackId="usage"
            fill="#d97757"
            stroke="#16161e"
            strokeWidth={2}
          />
          <Bar
            dataKey={keys.codex}
            name="Codex"
            stackId="usage"
            fill="#19c37d"
            stroke="#16161e"
            strokeWidth={2}
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
