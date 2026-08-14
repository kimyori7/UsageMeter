// 타입 전용 스텁 — v1 main/accounts-cycle.ts의 렌더러 노출 타입만 유지한다.
// 런타임 로직은 Rust(accounts_cycle.rs, 3단계)로 이식되며 이 파일은 타입 계약만 보존한다.
import type { ProviderId, RateStatus } from '../providers/types'

export interface AccountInfo {
  provider: ProviderId
  id: string
  email: string
  plan?: string
}

export interface AccountRateState {
  account: AccountInfo
  status: RateStatus
  /** 현재 OS 자격증명의 주인(로그인 중인 계정)인가 — live(조회 성공)와 별개의 축. */
  active: boolean
  live: boolean
  lastSeenAt: number
}
