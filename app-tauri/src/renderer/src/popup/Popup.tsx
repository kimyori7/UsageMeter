// 트레이 팝업 루트 — provider 그룹(계정 카드) + 하단 합계·액션 푸터. 계정 카드는 프로바이더당
// 1장만 보여준다(pickPopupAccount — 현재 로그인 계정 우선, 없으면 최근 스냅샷). 계정이 발견되지
// 않은 provider는 기존 ProviderCard로 폴백한다(하위 호환, 스펙 §UI). 실데이터는 useAppState()만 사용.
import AccountCard from './AccountCard'
import { pickPopupAccount } from './accountPick'
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
    const shown = pickPopupAccount(accounts.filter((a) => a.account.provider === p))
    if (!shown) {
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
        <AccountCard key={`${p}:${shown.account.id}`} entry={shown} now={now} />
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
