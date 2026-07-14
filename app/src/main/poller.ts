// 폴링 오케스트레이터: limits·usage(ccusage 4회 실행 + DB upsert) 모두 기본 5min 주기로 수집한다.
// limits 실패 시 직전 성공값을 stale=true로 유지하고 간격을 1분 고정 재시도(base가 그보다 짧으면 base
// 유지)로 좁히며, 성공하면 base로 복귀한다. usage 실패는 last-good 상태(DB에 남은 값)를 그대로 유지하고
// 조용히 재시도한다(usage 틱은 기존 지수 백오프 nextDelay를 그대로 쓴다).
// 타이머는 자기 재예약(self-rescheduling) setTimeout 체인이라 동시에 여러 틱이 겹치지 않는다.
import { EventEmitter } from 'node:events'
import type Database from 'better-sqlite3'
import type { DailyRow, ProviderId, RateStatus, SessionRow } from '../providers/types'
import type { AccountRateState, ActiveResults } from './accounts-cycle'
import type { CodexAccountIdentity, CodexUsageResult } from '../providers/codex/usage-api'

const LIMITS_MS_DEFAULT = 5 * 60_000
const USAGE_MS_DEFAULT = 5 * 60_000
const BACKOFF_CAP_MS = 15 * 60_000
export const LIMITS_RETRY_MS = 60_000

export interface AppState {
  limits: Record<ProviderId, RateStatus | null>
  today: Record<ProviderId, { costUsd: number; totalTokens: number }>
  lastUsageSyncAt: number | null
  accounts: AccountRateState[]
}

export interface PollerDeps {
  db: Database.Database
  fetchClaudeLimits: () => Promise<RateStatus>
  readCodexLimits: () => Promise<RateStatus>
  fetchCodexUsage: () => Promise<CodexUsageResult>
  accountsCycle?: (active: ActiveResults) => Promise<AccountRateState[]>
  runCcusage: (args: string[]) => Promise<unknown>
  normalizeDaily: (provider: ProviderId, cliJson: unknown) => DailyRow[]
  normalizeSessions: (
    provider: ProviderId,
    cliJson: unknown,
    codexCwdOf?: (directory: string, sessionFile: string) => string | null
  ) => SessionRow[]
  codexCwdOf?: (directory: string, sessionFile: string) => string | null
  upsertDaily: (db: Database.Database, rows: DailyRow[]) => void
  upsertSessions: (db: Database.Database, rows: SessionRow[]) => void
  recordSnapshots: (db: Database.Database, status: RateStatus) => void
  todayByProvider: (
    db: Database.Database,
    today: string
  ) => Record<ProviderId, { costUsd: number; totalTokens: number }>
}

export function nextDelay(baseMs: number, failures: number): number {
  return failures === 0 ? baseMs : Math.min(baseMs * 2 ** failures, BACKOFF_CAP_MS)
}

/** limits 틱 전용: 실패 중엔 짧게(1분) 재시도한다. base가 그보다 짧으면 base 유지(과폭주 방지). */
export function nextLimitsDelay(baseMs: number, failures: number): number {
  return failures === 0 ? baseMs : Math.min(LIMITS_RETRY_MS, baseMs)
}

function todayDateString(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export class Poller extends EventEmitter {
  private readonly deps: PollerDeps
  private readonly limitsBaseMs: number
  private readonly usageBaseMs: number
  private state: AppState
  private running = false
  private limitsRunning = false
  private usageRunning = false
  private limitsFailures = 0
  private limitsTimer: ReturnType<typeof setTimeout> | null = null
  private usageTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: PollerDeps, intervals: { limitsMs?: number; usageMs?: number } = {}) {
    super()
    this.deps = deps
    this.limitsBaseMs = intervals.limitsMs ?? LIMITS_MS_DEFAULT
    this.usageBaseMs = intervals.usageMs ?? USAGE_MS_DEFAULT
    this.state = {
      limits: { claude: null, codex: null },
      today: { claude: { costUsd: 0, totalTokens: 0 }, codex: { costUsd: 0, totalTokens: 0 } },
      lastUsageSyncAt: null,
      accounts: []
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    // 0ms setTimeout으로 걸어서 페이크 타이머 테스트에서도 결정적으로 흐르게 한다.
    this.scheduleLimits(0)
    this.scheduleUsage(0)
  }

  stop(): void {
    this.running = false
    if (this.limitsTimer) clearTimeout(this.limitsTimer)
    if (this.usageTimer) clearTimeout(this.usageTimer)
    this.limitsTimer = null
    this.usageTimer = null
  }

  async refreshNow(): Promise<void> {
    await Promise.all([this.tickLimits(), this.tickUsage()])
  }

  getState(): AppState {
    return {
      lastUsageSyncAt: this.state.lastUsageSyncAt,
      limits: { ...this.state.limits },
      today: { ...this.state.today },
      accounts: [...this.state.accounts]
    }
  }

  private emitState(): void {
    try {
      this.emit('state', this.getState())
    } catch {
      // 리스너(트레이/IPC 구독자)의 예외가 폴링 루프의 재예약을 막으면 안 된다.
    }
  }

  // 타이머 콜백은 fire-and-forget이라 .catch 백스톱으로 unhandled rejection을 차단한다.
  private scheduleLimits(delayMs: number): void {
    if (this.limitsTimer) clearTimeout(this.limitsTimer)
    this.limitsTimer = this.running
      ? setTimeout(() => void this.tickLimits().catch(() => undefined), delayMs)
      : null
  }

  private scheduleUsage(delayMs: number): void {
    if (this.usageTimer) clearTimeout(this.usageTimer)
    this.usageTimer = this.running
      ? setTimeout(() => void this.tickUsage().catch(() => undefined), delayMs)
      : null
  }

  private async tickLimits(): Promise<void> {
    if (this.limitsRunning) return
    this.limitsRunning = true
    let failed = false
    let codexAccount: CodexAccountIdentity | null = null

    // 계약상 fetchClaudeLimits/readCodexLimits/fetchCodexUsage는 throw하지 않고 실패를 status.error로
    // 알린다. status.stale은 "데이터는 유효하지만 오래됨"(codex mtime)일 수 있어 실패 신호가 아니다.
    const apply = (provider: ProviderId, status: RateStatus): void => {
      if (status.error) {
        failed = true
        this.state.limits[provider] = this.staleFallback(provider, status)
      } else {
        this.state.limits[provider] = status
        if (!this.deps.accountsCycle) {
          // 레거시 모드(accountsCycle 미제공, 예: 마이그레이션 실패)에서만 직접 기록 — 사이클 모드에선
          // 사이클이 계정 태그로 기록한다(이중 기록 금지).
          try {
            this.deps.recordSnapshots(this.deps.db, status)
          } catch {
            // 스냅샷 기록(DB) 실패는 fetch 성공 판정과 무관 — 상태는 정상 유지, 다음 틱에 재시도.
          }
        }
      }
    }

    try {
      apply('claude', await this.deps.fetchClaudeLimits())
    } catch {
      // 방어적 처리 — 실제 구현은 throw하지 않지만 예상 밖의 예외에도 동일하게 대응한다.
      failed = true
      this.state.limits.claude = this.staleFallback('claude', {
        provider: 'claude',
        windows: [],
        fetchedAt: Date.now(),
        error: 'network'
      })
    }

    try {
      const wham = await this.deps.fetchCodexUsage()
      codexAccount = wham.account
      let codexStatus = wham.status
      if (codexStatus.error) {
        const rollout = await this.deps.readCodexLimits()
        if (!rollout.error) codexStatus = rollout // wham 실패 시 rollout 폴백(스펙 §데이터 흐름 2)
      }
      apply('codex', codexStatus)
    } catch {
      failed = true
      this.state.limits.codex = this.staleFallback('codex', {
        provider: 'codex',
        windows: [],
        fetchedAt: Date.now(),
        error: 'network'
      })
    }

    if (this.deps.accountsCycle) {
      try {
        this.state.accounts = await this.deps.accountsCycle({
          claude: this.state.limits.claude,
          codex: { status: this.state.limits.codex, account: codexAccount }
        })
      } catch {
        // 사이클 실패는 limits 표시를 깨지 않는다 — 이전 accounts 유지, 다음 틱 재시도.
      }
    }

    this.limitsFailures = failed ? this.limitsFailures + 1 : 0
    this.limitsRunning = false
    this.emitState()
    this.scheduleLimits(nextLimitsDelay(this.limitsBaseMs, this.limitsFailures))
  }

  /** 직전 성공값이 있으면 그 값을 stale=true로 유지, 없으면 새로 온 에러 상태를 그대로 쓴다. */
  private staleFallback(provider: ProviderId, freshError: RateStatus): RateStatus {
    const prev = this.state.limits[provider]
    return prev ? { ...prev, stale: true, error: freshError.error } : freshError
  }

  /** 한 provider의 daily+session을 수집·정규화한다. CLI 실패 시 null — 다른 provider와 격리. */
  private async collectUsage(
    provider: ProviderId
  ): Promise<{ daily: DailyRow[]; sessions: SessionRow[] } | null> {
    try {
      const [daily, sessions] = await Promise.all([
        this.deps.runCcusage([provider, 'daily', '--json']),
        this.deps.runCcusage([provider, 'session', '--json'])
      ])
      return {
        daily: this.deps.normalizeDaily(provider, daily),
        sessions: this.deps.normalizeSessions(
          provider,
          sessions,
          provider === 'codex' ? this.deps.codexCwdOf : undefined
        )
      }
    } catch {
      return null // 이 provider의 CLI 실패 — 다른 provider의 정상 데이터는 계속 반영한다.
    }
  }

  private async tickUsage(): Promise<void> {
    if (this.usageRunning) return
    this.usageRunning = true
    try {
      const collected = await Promise.all([this.collectUsage('claude'), this.collectUsage('codex')])
      const ok = collected.filter((c) => c !== null)
      if (ok.length > 0) {
        this.deps.upsertDaily(
          this.deps.db,
          ok.flatMap((c) => c.daily)
        )
        this.deps.upsertSessions(
          this.deps.db,
          ok.flatMap((c) => c.sessions)
        )
        this.state.today = this.deps.todayByProvider(this.deps.db, todayDateString())
        this.state.lastUsageSyncAt = Date.now()
      }
    } catch {
      // DB upsert/재조회 실패 — last-good 상태(DB에 남은 이전 값)를 유지하고 다음 주기에 재시도.
    } finally {
      this.usageRunning = false
      this.emitState()
      this.scheduleUsage(this.usageBaseMs)
    }
  }
}
