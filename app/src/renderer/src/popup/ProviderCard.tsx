// 프로바이더 카드 하나: 헤더(색점+이름+플랜 배지) / 존재하는 창마다 GaugeBar / "오늘 사용" 비용.
// windows 배열 순서를 가정하지 않고 kind로 명시 선택한다(providers/types.ts 계약).
// error가 있어도 windows가 남아있으면(poller의 직전 성공값 유지 정책, staleFallback) 게이지를 계속
// 그린다 — 빈 화면 금지(스펙 §7). "오늘 사용"은 ccusage 기반 별도 파이프라인(AppState.today)이라
// limits 에러와 무관하게 항상 표시한다. stale은 에러가 아니라 "값이 오래됨" 표시 — 옅은 캡션만 붙인다.
import GaugeBar from './GaugeBar'
import { fmtMoney, fmtTokens } from './format'
import type { ProviderId, RateStatus } from '../../../providers/types'

const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex' }

interface ProviderCardProps {
  providerId: ProviderId
  status: RateStatus | null // 최초 폴링 틱 전(AppState.limits[p])에는 null일 수 있다
  today: { costUsd: number; totalTokens: number }
  now: number // epoch ms — 호출자(Popup)가 useNow()로 공급한다(렌더 중 Date.now() 직접 호출 금지)
}

/** 'HH:MM' 24시간제, 2자리 패딩 — "마지막 갱신" 캡션용. */
function fmtClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** fetchedAt(마지막 성공 시점)로부터 경과 분 — stale 캡션 "{n}분 전 활동 기준"용. */
function minutesAgo(fetchedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - fetchedAtMs) / 60_000))
}

export default function ProviderCard({
  providerId,
  status,
  today,
  now
}: ProviderCardProps): React.JSX.Element {
  const label = PROVIDER_LABEL[providerId]
  const dot = <span className={`provider-dot provider-dot--${providerId}`} />

  if (!status) {
    return (
      <div className="provider-card provider-card--loading">
        <div className="provider-header">
          {dot}
          <span className="provider-name">{label}</span>
        </div>
        <div className="provider-caption">불러오는 중…</div>
      </div>
    )
  }

  const session = status.windows.find((w) => w.kind === 'session_5h')
  const weekly = status.windows.find((w) => w.kind === 'weekly')
  const hasError = status.error !== undefined
  const nowSec = Math.floor(now / 1000)

  return (
    <div className={`provider-card${hasError ? ' provider-card--error' : ''}`}>
      <div className="provider-header">
        {dot}
        <span className="provider-name">{label}</span>
        {status.plan && <span className="provider-plan">{status.plan}</span>}
      </div>

      {session && (
        <GaugeBar
          label="5시간 세션"
          providerId={providerId}
          usedPercent={session.usedPercent}
          resetsAt={session.resetsAt}
          now={nowSec}
        />
      )}
      {weekly && (
        <GaugeBar
          label="주간 한도"
          providerId={providerId}
          usedPercent={weekly.usedPercent}
          resetsAt={weekly.resetsAt}
          now={nowSec}
        />
      )}

      {hasError && (
        <div className="provider-caption provider-caption--error">
          연결 안 됨 · 마지막 갱신 {fmtClock(status.fetchedAt)}
          {status.error === 'unauthorized' && <div>Claude Code에서 /login 필요</div>}
        </div>
      )}
      {!hasError && status.stale && (
        <div className="provider-caption">{minutesAgo(status.fetchedAt, now)}분 전 활동 기준</div>
      )}

      <div className="provider-cost">
        <span>오늘 사용</span>
        <span>
          <b>{fmtMoney(today.costUsd)}</b> · {fmtTokens(today.totalTokens)}
        </span>
      </div>
    </div>
  )
}
