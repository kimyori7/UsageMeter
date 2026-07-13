// 프로바이더별 한도 게이지 한 줄: 라벨 + "%·리셋" 캡션 + 막대. 순수 표시 컴포넌트 — 데이터는 위(ProviderCard)에서
// RateWindow.kind로 골라 내려준다(이 컴포넌트는 어떤 창인지 모른다, label 문자열만 받는다).
import { fmtReset } from './format'
import type { ProviderId } from '../../../providers/types'

const WARN_THRESHOLD = 90
const WARN_COLOR = '#e0a030'

interface GaugeBarProps {
  label: string // '5시간 세션' | '주간 한도'
  providerId: ProviderId // gauge-fill 그라디언트 색 클래스 선택용
  usedPercent: number // 0-100
  resetsAt: number // epoch 초
  now: number // epoch 초 — 호출자(ProviderCard)가 useNow()에서 내려준다
}

/** usedPercent≥90은 프로바이더 그라디언트 대신 경고색(#e0a030)으로 덮어쓴다(인라인 style이 클래스보다 우선). */
export default function GaugeBar({
  label,
  providerId,
  usedPercent,
  resetsAt,
  now
}: GaugeBarProps): React.JSX.Element {
  const widthPercent = Math.max(0, Math.min(100, usedPercent))
  const isWarn = usedPercent >= WARN_THRESHOLD

  return (
    <div className="gauge-row">
      <div className="gauge-label">
        <span>{label}</span>
        <b>
          {Math.round(usedPercent)}% · {fmtReset(resetsAt, now)}
        </b>
      </div>
      <div className="gauge-track">
        <div
          className={`gauge-fill gauge-fill--${providerId}`}
          style={{ width: `${widthPercent}%`, ...(isWarn ? { background: WARN_COLOR } : {}) }}
        />
      </div>
    </div>
  )
}
