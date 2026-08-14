// 팝업에 표시할 계정 선별 — 프로바이더당 1장만 보여준다: 현재 로그인 계정(active) 우선,
// 로그인 계정이 없으면(전부 로그아웃) 마지막으로 관측된 계정의 스냅샷 카드 1장으로 폴백한다.
// 과거 계정들의 정보는 사라지는 게 아니라 스냅샷 DB에 그대로 남는다(표시만 줄임).
import type { AccountRateState } from '../../../main/accounts-cycle'

export function pickPopupAccount(group: AccountRateState[]): AccountRateState | null {
  if (group.length === 0) return null
  const sorted = [...group].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      Number(b.live) - Number(a.live) ||
      b.lastSeenAt - a.lastSeenAt
  )
  return sorted[0]
}
