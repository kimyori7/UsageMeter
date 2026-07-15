// 타입 전용 스텁 — v1 main/poller.ts의 AppState 계약만 보존 (런타임은 Rust poller.rs, 4단계).
import type { ProviderId, RateStatus } from '../providers/types'
import type { AccountRateState } from './accounts-cycle'

export interface AppState {
  limits: Record<ProviderId, RateStatus | null>
  today: Record<ProviderId, { costUsd: number; totalTokens: number }>
  lastUsageSyncAt: number | null
  accounts: AccountRateState[]
}
