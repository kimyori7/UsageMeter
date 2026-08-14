import { describe, expect, it } from 'vitest'
import { pickPopupAccount } from './accountPick'
import type { AccountRateState } from '../../../main/accounts-cycle'

function acct(
  id: string,
  opts: { active?: boolean; live?: boolean; lastSeenAt?: number } = {}
): AccountRateState {
  return {
    account: { provider: 'codex', id, email: `${id}@example.com` },
    status: { provider: 'codex', windows: [], fetchedAt: 0 },
    active: opts.active ?? false,
    live: opts.live ?? false,
    lastSeenAt: opts.lastSeenAt ?? 0
  }
}

describe('pickPopupAccount', () => {
  it('빈 그룹이면 null', () => {
    expect(pickPopupAccount([])).toBeNull()
  })

  it('현재 로그인 계정(active)을 최우선으로 고른다 — live·최신 관측보다 우선', () => {
    const group = [
      acct('vault-live', { live: true, lastSeenAt: 9000 }), // 볼트 조회 성공(live)이지만 로그인 계정 아님
      acct('logged-in', { active: true, live: true, lastSeenAt: 1000 })
    ]
    expect(pickPopupAccount(group)?.account.id).toBe('logged-in')
  })

  it('active가 없으면(전부 로그아웃) live > 최근 관측 순으로 1개 폴백', () => {
    const group = [
      acct('old-snapshot', { lastSeenAt: 1000 }),
      acct('new-snapshot', { lastSeenAt: 5000 })
    ]
    expect(pickPopupAccount(group)?.account.id).toBe('new-snapshot')
  })

  it('입력 배열을 변경하지 않는다', () => {
    const group = [acct('a', { lastSeenAt: 1 }), acct('b', { active: true })]
    pickPopupAccount(group)
    expect(group.map((g) => g.account.id)).toEqual(['a', 'b'])
  })
})
