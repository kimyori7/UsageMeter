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
  live: boolean
  lastSeenAt: number
}
