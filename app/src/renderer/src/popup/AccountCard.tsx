// 계정 카드 하나(스펙 §UI). ProviderCard와 달리 "오늘 사용"이 없다(비용은 provider 단위 —
// 그룹 헤더가 담당). 스냅샷 카드는 마지막 성공 후 SNAPSHOT_GRACE_MS(10분)가 지나야 흐려진다(isDimmed) —
// 그 전까지는 밝은 카드 + "HH:MM 기준" 스탬프. 리셋 지난 창은 게이지 대신 문구.
import GaugeBar from './GaugeBar'
import { displayWindow, isDimmed, type DisplayWindow } from './accountView'
import { fmtClock } from './format'
import type { AccountRateState } from '../../../main/accounts-cycle'

interface AccountCardProps {
  entry: AccountRateState
  now: number // epoch ms — Popup의 useNow()
}

export default function AccountCard({ entry, now }: AccountCardProps): React.JSX.Element {
  const { account, status, live, lastSeenAt } = entry
  const dimmed = isDimmed(live, lastSeenAt, now)
  const nowSec = Math.floor(now / 1000)
  const session = displayWindow(
    status.windows.find((w) => w.kind === 'session_5h') ?? null,
    nowSec,
    live
  )
  const weekly = displayWindow(
    status.windows.find((w) => w.kind === 'weekly') ?? null,
    nowSec,
    live
  )

  const gauge = (label: string, d: DisplayWindow): React.JSX.Element =>
    d.resetPassed ? (
      <div className="gauge-row gauge-row--reset">
        <div className="gauge-label">
          <span>{label}</span>
          <b>리셋됨 · 여유 있음</b>
        </div>
        <div className="gauge-track" />
      </div>
    ) : (
      <GaugeBar label={label} providerId={account.provider} rateWindow={d.window} now={nowSec} />
    )

  return (
    <div className={`account-card${dimmed ? ' account-card--snapshot' : ''}`}>
      <div className="account-header">
        <span className="account-email" title={account.email || account.id}>
          {account.email || account.id}
        </span>
        {account.plan && <span className="provider-plan">{account.plan}</span>}
        {live ? (
          <span className="account-badge account-badge--live">● 로그인 중</span>
        ) : (
          <span className="account-badge">{fmtClock(lastSeenAt)} 기준</span>
        )}
      </div>
      {gauge('5시간 세션', session)}
      {gauge('주간 한도', weekly)}
      {!live && status.error === 'no-data' && (
        <div className="provider-caption">기록된 수치 없음 — 이 계정으로 로그인하면 수집됩니다</div>
      )}
    </div>
  )
}
