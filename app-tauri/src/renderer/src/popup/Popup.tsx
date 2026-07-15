// 트레이 팝업 루트 — provider 그룹(계정 카드 목록) + 하단 합계·액션 푸터. 계정이 발견되지 않은
// provider는 기존 ProviderCard로 폴백한다(하위 호환, 스펙 §UI). 실데이터는 useAppState()만 사용.
import AccountCard from './AccountCard'
import ProviderCard from './ProviderCard'
import { fmtMoney, fmtTokens } from './format'
import { useNow } from './useNow'
import { usePopupHeight } from './usePopupHeight'
import { openDashboard, refresh, useAppState } from '../api'
import type { ProviderId } from '../../../providers/types'

const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex' }

export default function Popup(): React.JSX.Element {
  const state = useAppState()
  const now = useNow()
  const rootRef = usePopupHeight<HTMLDivElement>()

  if (!state) {
    return (
      <div className="popup" ref={rootRef}>
        <div className="popup-loading">불러오는 중…</div>
      </div>
    )
  }

  const total = state.today.claude.costUsd + state.today.codex.costUsd
  const accounts = state.accounts ?? []

  const providerSection = (p: ProviderId): React.JSX.Element => {
    const group = accounts
      .filter((a) => a.account.provider === p)
      .sort((a, b) => Number(b.live) - Number(a.live) || b.lastSeenAt - a.lastSeenAt)
    if (group.length === 0) {
      return (
        <ProviderCard providerId={p} status={state.limits[p]} today={state.today[p]} now={now} />
      )
    }
    return (
      <div className="account-group">
        <div className="account-group-header">
          <span className={`provider-dot provider-dot--${p}`} />
          <span className="provider-name">{PROVIDER_LABEL[p]}</span>
          <span className="account-group-today">
            오늘 <b>{fmtMoney(state.today[p].costUsd)}</b> · {fmtTokens(state.today[p].totalTokens)}
          </span>
        </div>
        {group.map((a) => (
          <AccountCard key={`${p}:${a.account.id}`} entry={a} now={now} />
        ))}
      </div>
    )
  }

  return (
    <div className="popup" ref={rootRef}>
      {providerSection('claude')}
      {providerSection('codex')}
      <div className="popup-footer">
        <span>
          오늘 합계 <b>{fmtMoney(total)}</b>
        </span>
        <span className="popup-actions">
          <button type="button" onClick={() => void refresh()}>
            ⟳ 새로고침
          </button>
          <button type="button" onClick={() => void openDashboard()}>
            대시보드 ↗
          </button>
        </span>
      </div>
    </div>
  )
}
