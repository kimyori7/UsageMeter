// 트레이 팝업 루트 — 프로바이더 카드 세로 스택(Claude/Codex) + 하단 합계·액션 푸터.
// 실데이터는 api.ts의 useAppState()(IPC 구독, Task 9)로만 받는다 — window.usagemeter 직접 접근 금지.
import ProviderCard from './ProviderCard'
import { fmtMoney } from './format'
import { useNow } from './useNow'
import { usePopupHeight } from './usePopupHeight'
import { openDashboard, refresh, useAppState } from '../api'

export default function Popup(): React.JSX.Element {
  const state = useAppState()
  const now = useNow()
  // 루트 높이를 메인에 보고해 창을 content-fit — 두 return 분기 모두 같은 위치의 .popup 루트 div라
  // React가 DOM 노드를 재사용하므로 마운트 시 한 번 잡은 ref가 상태 전환 후에도 유효하다.
  const rootRef = usePopupHeight<HTMLDivElement>()

  if (!state) {
    return (
      <div className="popup" ref={rootRef}>
        <div className="popup-loading">불러오는 중…</div>
      </div>
    )
  }

  const total = state.today.claude.costUsd + state.today.codex.costUsd

  return (
    <div className="popup" ref={rootRef}>
      <ProviderCard
        providerId="claude"
        status={state.limits.claude}
        today={state.today.claude}
        now={now}
      />
      <ProviderCard
        providerId="codex"
        status={state.limits.codex}
        today={state.today.codex}
        now={now}
      />
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
