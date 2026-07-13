// 폴링 오케스트레이터: limits는 60s, usage(ccusage 4회 실행 + DB upsert)는 5min 주기로 수집한다.
// limits 실패 시 직전 성공값을 stale=true로 유지하고 간격을 실패 횟수당 2배(최대 15분)로 늘리며,
// 성공하면 리셋한다. usage 실패는 last-good 상태(DB에 남은 값)를 그대로 유지하고 조용히 재시도한다.
// 타이머는 자기 재예약(self-rescheduling) setTimeout 체인이라 동시에 여러 틱이 겹치지 않는다.
import { EventEmitter } from 'node:events'
import type Database from 'better-sqlite3'
import type { DailyRow, ProviderId, RateStatus, SessionRow } from '../providers/types'

const LIMITS_MS_DEFAULT = 60_000
const USAGE_MS_DEFAULT = 5 * 60_000
const BACKOFF_CAP_MS = 15 * 60_000

export interface AppState {
  limits: Record<ProviderId, RateStatus | null>
  today: Record<ProviderId, { costUsd: number; totalTokens: number }>
  lastUsageSyncAt: number | null
}

export interface PollerDeps {
  db: Database.Database
  fetchClaudeLimits: () => Promise<RateStatus>
  readCodexLimits: () => Promise<RateStatus>
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
      lastUsageSyncAt: null
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    // 0ms setTimeout으로 걸어서 페이크 타이머 테스트에서도 결정적으로 흐르게 한다.
    this.limitsTimer = setTimeout(() => void this.tickLimits(), 0)
    this.usageTimer = setTimeout(() => void this.tickUsage(), 0)
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
      today: { ...this.state.today }
    }
  }

  private emitState(): void {
    this.emit('state', this.getState())
  }

  private scheduleLimits(delayMs: number): void {
    if (this.limitsTimer) clearTimeout(this.limitsTimer)
    this.limitsTimer = this.running ? setTimeout(() => void this.tickLimits(), delayMs) : null
  }

  private scheduleUsage(delayMs: number): void {
    if (this.usageTimer) clearTimeout(this.usageTimer)
    this.usageTimer = this.running ? setTimeout(() => void this.tickUsage(), delayMs) : null
  }

  private async fetchProviderLimits(provider: ProviderId): Promise<RateStatus> {
    return provider === 'claude' ? this.deps.fetchClaudeLimits() : this.deps.readCodexLimits()
  }

  private async tickLimits(): Promise<void> {
    if (this.limitsRunning) return
    this.limitsRunning = true
    let failed = false
    for (const provider of ['claude', 'codex'] as const) {
      try {
        const status = await this.fetchProviderLimits(provider)
        // 계약상 fetchClaudeLimits/readCodexLimits는 throw하지 않고 실패를 status.error로 알린다.
        // status.stale은 "데이터는 유효하지만 오래됨"(codex mtime)일 수 있어 실패 신호가 아니다.
        if (status.error) {
          failed = true
          this.state.limits[provider] = this.staleFallback(provider, status)
        } else {
          this.state.limits[provider] = status
          this.deps.recordSnapshots(this.deps.db, status)
        }
      } catch {
        // 방어적 처리 — 실제 구현은 throw하지 않지만 예상 밖의 예외에도 동일하게 대응한다.
        failed = true
        this.state.limits[provider] = this.staleFallback(provider, {
          provider,
          windows: [],
          fetchedAt: Date.now(),
          error: 'network'
        })
      }
    }
    this.limitsFailures = failed ? this.limitsFailures + 1 : 0
    this.limitsRunning = false
    this.emitState()
    this.scheduleLimits(nextDelay(this.limitsBaseMs, this.limitsFailures))
  }

  /** 직전 성공값이 있으면 그 값을 stale=true로 유지, 없으면 새로 온 에러 상태를 그대로 쓴다. */
  private staleFallback(provider: ProviderId, freshError: RateStatus): RateStatus {
    const prev = this.state.limits[provider]
    return prev ? { ...prev, stale: true, error: freshError.error } : freshError
  }

  private async tickUsage(): Promise<void> {
    if (this.usageRunning) return
    this.usageRunning = true
    try {
      const [claudeDaily, codexDaily, claudeSessions, codexSessions] = await Promise.all([
        this.deps.runCcusage(['claude', 'daily', '--json']),
        this.deps.runCcusage(['codex', 'daily', '--json']),
        this.deps.runCcusage(['claude', 'session', '--json']),
        this.deps.runCcusage(['codex', 'session', '--json'])
      ])
      const dailyRows = [
        ...this.deps.normalizeDaily('claude', claudeDaily),
        ...this.deps.normalizeDaily('codex', codexDaily)
      ]
      const sessionRows = [
        ...this.deps.normalizeSessions('claude', claudeSessions),
        ...this.deps.normalizeSessions('codex', codexSessions, this.deps.codexCwdOf)
      ]
      this.deps.upsertDaily(this.deps.db, dailyRows)
      this.deps.upsertSessions(this.deps.db, sessionRows)
      this.state.today = this.deps.todayByProvider(this.deps.db, todayDateString())
      this.state.lastUsageSyncAt = Date.now()
    } catch {
      // ccusage/DB 실패 — last-good 상태(DB에 남은 이전 값)를 유지하고 다음 주기에 재시도.
    } finally {
      this.usageRunning = false
      this.emitState()
      this.scheduleUsage(this.usageBaseMs)
    }
  }
}
