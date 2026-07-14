// 프로바이더 카드 하나: 헤더(색점+이름+플랜 배지) / 게이지 두 줄(5시간 세션 + 주간 한도, 항상) / "오늘 사용" 비용.
// 확정 레이아웃은 카드당 두 게이지 고정 — 데이터에 없는 kind는 줄을 없애지 않고 흐린 자리 표시 줄로 렌더해
// 카드 구조가 로딩/에러/부분 데이터 어느 상태에서든 안정되게 유지한다. windows 배열 순서를 가정하지 않고
// kind로 명시 선택한다(providers/types.ts 계약). error가 있어도 windows가 남아있으면(poller의 직전 성공값
// 유지 정책, staleFallback) 게이지를 계속 그린다 — 빈 화면 금지(스펙 §7). "오늘 사용"은 ccusage 기반 별도
// 파이프라인(AppState.today)이라 limits 에러와 무관하게 항상 표시한다. stale은 에러가 아니라 옅은 캡션만.
import GaugeBar from './GaugeBar'
import { fmtClock, fmtMoney, fmtTokens } from './format'
import type { ProviderId, RateStatus } from '../../../providers/types'

const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex' }

interface ProviderCardProps {
  providerId: ProviderId
  status: RateStatus | null // 최초 폴링 틱 전(AppState.limits[p])에는 null일 수 있다
  today: { costUsd: number; totalTokens: number }
  now: number // epoch ms — 호출자(Popup)가 useNow()로 공급한다(렌더 중 Date.now() 직접 호출 금지)
}

/** fetchedAt(마지막 성공 시점)로부터 경과 분 — stale 캡션 "{n}분 전 활동 기준"용. */
function minutesAgo(fetchedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - fetchedAtMs) / 60_000))
}

/** 상태별 캡션 한 줄 — 로딩 / 에러(연결 안 됨) / stale(오래된 값) / 정상(없음). */
function caption(status: RateStatus | null, nowMs: number): React.JSX.Element | null {
  if (!status) return <div className="provider-caption">불러오는 중…</div>
  if (status.error) {
    return (
      <div className="provider-caption provider-caption--error">
        연결 안 됨 · 마지막 갱신 {fmtClock(status.fetchedAt)}
        {status.error === 'unauthorized' && <div>Claude Code에서 /login 필요</div>}
      </div>
    )
  }
  if (status.stale) {
    return (
      <div className="provider-caption">{minutesAgo(status.fetchedAt, nowMs)}분 전 활동 기준</div>
    )
  }
  return null
}

export default function ProviderCard({
  providerId,
  status,
  today,
  now
}: ProviderCardProps): React.JSX.Element {
  const windows = status?.windows ?? []
  const session = windows.find((w) => w.kind === 'session_5h') ?? null
  const weekly = windows.find((w) => w.kind === 'weekly') ?? null
  const hasError = Boolean(status?.error)
  const nowSec = Math.floor(now / 1000)

  return (
    <div className={`provider-card${hasError ? ' provider-card--error' : ''}`}>
      <div className="provider-header">
        <span className={`provider-dot provider-dot--${providerId}`} />
        <span className="provider-name">{PROVIDER_LABEL[providerId]}</span>
        {status?.plan && <span className="provider-plan">{status.plan}</span>}
      </div>

      <GaugeBar label="5시간 세션" providerId={providerId} rateWindow={session} now={nowSec} />
      <GaugeBar label="주간 한도" providerId={providerId} rateWindow={weekly} now={nowSec} />

      {caption(status, now)}

      <div className="provider-cost">
        <span>오늘 사용</span>
        <span>
          <b>{fmtMoney(today.costUsd)}</b> · {fmtTokens(today.totalTokens)}
        </span>
      </div>
    </div>
  )
}
