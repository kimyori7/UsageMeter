// 기간 선택 칩(1/3/7/30/90일/전체) — 개요/일별 기록/폴더·세션 탭이 공유하는 셸 상태를 그린다.
// 실제 날짜 범위 계산은 dashboard/period.ts(순수함수)가 맡고, 이 컴포넌트는 선택 UI만 담당한다.
import type { Period } from '../dashboard/period'

const OPTIONS: Array<{ value: Period; label: string }> = [
  { value: '1d', label: '1일' },
  { value: '3d', label: '3일' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
  { value: '90d', label: '90일' },
  { value: 'all', label: '전체' }
]

interface PeriodChipsProps {
  value: Period
  onChange: (period: Period) => void
}

export default function PeriodChips({ value, onChange }: PeriodChipsProps): React.JSX.Element {
  return (
    <div className="chips">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`chip${opt.value === value ? ' chip--on' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
