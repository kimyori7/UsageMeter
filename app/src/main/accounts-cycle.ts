// 계정 오케스트레이션(스펙 §데이터 흐름 1·3·4·5). Poller의 limits 틱이 활성 결과를 넘겨 호출한다.
// 코덱스에는 재발급 경로가 구조적으로 존재하지 않는다(deps.codex에 ensureToken 자체가 없음 — 스펙 F3).
import type Database from 'better-sqlite3'
import type { ProviderId, RateStatus } from '../providers/types'
import type { ClaudeAccountIdentity } from '../providers/claude/account'
import type { CodexAuth } from '../providers/codex/auth'
import type { CodexAccountIdentity, CodexUsageResult } from '../providers/codex/usage-api'
import {
  listAccounts,
  touchLoginPeriod,
  upsertAccount,
  type AccountRecord
} from '../store/accounts'
import { latestAccountSnapshot, recordSnapshots } from '../store/snapshots'
import type { AccountVault } from './account-vault'

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

export interface ActiveResults {
  claude: RateStatus | null
  codex: { status: RateStatus | null; account: CodexAccountIdentity | null }
}

export interface AccountsCycleDeps {
  db: Database.Database
  vault: AccountVault
  now?: () => number
  claude: {
    credPath: string
    readAccount: () => ClaudeAccountIdentity | null
    ensureToken: (credPath: string) => Promise<string | null>
    fetchLimits: (token: string | null) => Promise<RateStatus>
  }
  codex: {
    authPath: string
    readVaultAuth: (vaultPath: string) => CodexAuth | null
    fetchUsage: (auth: CodexAuth) => Promise<CodexUsageResult>
  }
}

export async function runAccountsCycle(
  deps: AccountsCycleDeps,
  active: ActiveResults
): Promise<AccountRateState[]> {
  const nowMs = (deps.now ?? Date.now)()
  const { db, vault } = deps
  const states: AccountRateState[] = []

  /** 활성 계정 공통 처리. 반환값 = 활성 계정 id(신원 미상이면 null). */
  const registerActive = (
    provider: ProviderId,
    identity: { id: string; email: string; plan?: string } | null,
    status: RateStatus | null,
    sourcePath: string
  ): string | null => {
    if (!identity) {
      // 신원 미상이어도 성공 수치는 '' 태그로 남겨 이력을 잇는다(하위 호환 표시가 이 행들을 쓴다).
      if (status && !status.error) safeRecord(status, '')
      return null
    }
    upsertAccount(
      db,
      { provider, id: identity.id, email: identity.email, plan: identity.plan },
      nowMs
    )
    touchLoginPeriod(db, provider, identity.id, nowMs)
    vault.copyIfChanged(provider, identity.id, sourcePath)
    if (status) {
      if (!status.error) safeRecord(status, identity.id)
      states.push({
        account: { provider, ...identity },
        status,
        live: !status.error,
        lastSeenAt: status.error ? nowMs : status.fetchedAt
      })
    }
    return identity.id
  }

  const safeRecord = (status: RateStatus, accountId: string): void => {
    try {
      recordSnapshots(db, status, accountId)
    } catch {
      // 스냅샷 기록 실패는 표시(라이브 상태)에 영향을 주지 않는다 — 다음 틱 재시도.
    }
  }

  const snapshotState = (provider: ProviderId, rec: AccountRecord): AccountRateState => {
    const snap = latestAccountSnapshot(db, provider, rec.id)
    return {
      account: { provider, id: rec.id, email: rec.email, plan: rec.plan },
      status: snap
        ? { provider, windows: snap.windows, fetchedAt: snap.fetchedAt }
        : { provider, windows: [], fetchedAt: rec.lastSeenAt, error: 'no-data' },
      live: false,
      lastSeenAt: snap?.fetchedAt ?? rec.lastSeenAt
    }
  }

  // ---- Claude ----
  const claudeActiveId = registerActive(
    'claude',
    deps.claude.readAccount(),
    active.claude,
    deps.claude.credPath
  )
  for (const rec of listAccounts(db, 'claude')) {
    if (rec.id === claudeActiveId) continue
    try {
      if (vault.isRevoked('claude', rec.id) || !vault.hasCopy('claude', rec.id)) {
        states.push(snapshotState('claude', rec))
        continue
      }
      const token = await deps.claude.ensureToken(vault.credPath('claude', rec.id))
      const status = await deps.claude.fetchLimits(token)
      if (status.error === 'unauthorized' || status.error === 'no-credentials') {
        vault.markRevoked('claude', rec.id)
        states.push(snapshotState('claude', rec))
      } else if (status.error) {
        states.push(snapshotState('claude', rec)) // 일시 오류(network 등) — revoked 아님
      } else {
        safeRecord(status, rec.id)
        states.push({
          account: { provider: 'claude', id: rec.id, email: rec.email, plan: rec.plan },
          status,
          live: true,
          lastSeenAt: status.fetchedAt
        })
      }
    } catch {
      states.push(snapshotState('claude', rec)) // 한 계정의 실패가 사이클을 죽이지 않는다
    }
  }

  // ---- Codex ----
  const codexActiveId = registerActive(
    'codex',
    active.codex.account,
    active.codex.status,
    deps.codex.authPath
  )
  for (const rec of listAccounts(db, 'codex')) {
    if (rec.id === codexActiveId) continue
    try {
      if (vault.isRevoked('codex', rec.id) || !vault.hasCopy('codex', rec.id)) {
        states.push(snapshotState('codex', rec))
        continue
      }
      const auth = deps.codex.readVaultAuth(vault.credPath('codex', rec.id))
      if (!auth) {
        states.push(snapshotState('codex', rec))
        continue
      }
      const { status } = await deps.codex.fetchUsage(auth)
      if (status.error === 'unauthorized' || status.error === 'no-credentials') {
        vault.markRevoked('codex', rec.id)
        states.push(snapshotState('codex', rec))
      } else if (status.error) {
        states.push(snapshotState('codex', rec))
      } else {
        safeRecord(status, rec.id)
        states.push({
          account: { provider: 'codex', id: rec.id, email: rec.email, plan: rec.plan },
          status,
          live: true,
          lastSeenAt: status.fetchedAt
        })
      }
    } catch {
      states.push(snapshotState('codex', rec))
    }
  }

  return states
}
