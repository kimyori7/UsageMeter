// 프로바이더별 한도 게이지 한 줄: 라벨 + "%·리셋" 캡션 + 막대. 순수 표시 컴포넌트 — 데이터는 위(ProviderCard)에서
// RateWindow.kind로 골라 내려준다(이 컴포넌트는 어떤 창인지 모른다, label 문자열만 받는다).
// rateWindow가 null이면(해당 kind가 데이터에 없음) 줄을 없애지 않고 흐린 자리 표시 줄(라벨 + — + 빈 트랙)로
// 렌더한다 — 확정 레이아웃은 카드당 두 게이지 줄 고정이라 데이터 상태와 무관하게 구조가 안정돼야 한다.
import { displayPercent, fmtReset, isWarnPercent } from './format'
import type { ProviderId, RateWindow } from '../../../providers/types'

const WARN_COLOR = '#e0a030'

interface GaugeBarProps {
  label: string // '5시간 세션' | '주간 한도'
  providerId: ProviderId // gauge-fill 그라디언트 색 클래스 선택용
  rateWindow: RateWindow | null // null → 자리 표시 줄(값 —, 빈 트랙, 흐리게)
  now: number // epoch 초 — 호출자(ProviderCard)가 useNow()에서 내려준다
}

/**
 * 표시 %가 90 이상이면 프로바이더 그라디언트 대신 경고색(#e0a030)으로 덮어쓴다(인라인 style이 클래스보다 우선).
 * 라벨과 경고 판정 모두 같은 반올림 값(displayPercent/isWarnPercent, format.ts)을 쓴다 — 89.6이
 * "90%"로 표시되면서 경고색은 꺼져 있는 표시-색 모순 방지. 막대 폭만 원본 %(연속값)를 유지한다.
 */
export default function GaugeBar({
  label,
  providerId,
  rateWindow,
  now
}: GaugeBarProps): React.JSX.Element {
  if (!rateWindow) {
    return (
      <div className="gauge-row gauge-row--absent">
        <div className="gauge-label">
          <span>{label}</span>
          <b>—</b>
        </div>
        <div className="gauge-track" />
      </div>
    )
  }

  const widthPercent = Math.max(0, Math.min(100, rateWindow.usedPercent))
  const isWarn = isWarnPercent(rateWindow.usedPercent)

  return (
    <div className="gauge-row">
      <div className="gauge-label">
        <span>{label}</span>
        <b>
          {displayPercent(rateWindow.usedPercent)}% · {fmtReset(rateWindow.resetsAt, now)}
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
