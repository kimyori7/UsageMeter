import { describe, it, expect, vi, afterEach } from 'vitest'
import { openDb } from '../store/db'
import { Poller, nextLimitsDelay, type PollerDeps } from './poller'
import type { RateStatus } from '../providers/types'

function claudeStatus(overrides: Partial<RateStatus> = {}): RateStatus {
  return {
    provider: 'claude',
    windows: [{ kind: 'session_5h', usedPercent: 10, resetsAt: 1000 }],
    fetchedAt: 1,
    ...overrides
  }
}

function codexStatus(overrides: Partial<RateStatus> = {}): RateStatus {
  return {
    provider: 'codex',
    windows: [{ kind: 'session_5h', usedPercent: 20, resetsAt: 2000 }],
    fetchedAt: 2,
    ...overrides
  }
}

function makeDeps(overrides: Partial<PollerDeps> = {}): PollerDeps {
  return {
    db: openDb(':memory:'),
    fetchClaudeLimits: vi.fn().mockResolvedValue(claudeStatus()),
    readCodexLimits: vi.fn().mockResolvedValue(codexStatus()),
    // 기본값: wham은 network 에러로 스텁 — 기존 케이스들이 rollout(readCodexLimits) 경로로 흘러
    // 기존 기대값을 그대로 보존한다. 신규 wham 관련 케이스는 overrides로 이 스텁을 덮어쓴다.
    fetchCodexUsage: vi.fn().mockResolvedValue({
      account: null,
      status: { provider: 'codex', windows: [], fetchedAt: Date.now(), error: 'network' as const }
    }),
    runCcusage: vi.fn().mockResolvedValue({ daily: [], sessions: [] }),
    normalizeDaily: vi.fn().mockReturnValue([]),
    normalizeSessions: vi.fn().mockReturnValue([]),
    upsertDaily: vi.fn(),
    upsertSessions: vi.fn(),
    recordSnapshots: vi.fn(),
    todayByProvider: vi.fn().mockReturnValue({
      claude: { costUsd: 0, totalTokens: 0 },
      codex: { costUsd: 0, totalTokens: 0 }
    }),
    // accountsCycle는 기본 미지정(undefined) — 기존 케이스는 레거시 recordSnapshots 경로 그대로 검증된다.
    ...overrides
  }
}

describe('Poller', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('collects immediately on start (limits + usage)', async () => {
    vi.useFakeTimers()
    const deps = makeDeps()
    const poller = new Poller(deps)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(1)
    expect(deps.readCodexLimits).toHaveBeenCalledTimes(1)
    expect(deps.runCcusage).toHaveBeenCalledTimes(4)
    poller.stop()
  })

  it('re-polls limits after 5 minutes (new base interval)', async () => {
    vi.useFakeTimers()
    const deps = makeDeps()
    const poller = new Poller(deps)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('re-polls usage after 5 minutes, not before', async () => {
    vi.useFakeTimers()
    const deps = makeDeps()
    const poller = new Poller(deps)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.runCcusage).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(60_000) // still short of the 5min usage base (limits base is now 5min too, so no extra limits tick fires here either)
    expect(deps.runCcusage).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(240_000) // total 300_000 since start
    expect(deps.runCcusage).toHaveBeenCalledTimes(8)
    poller.stop()
  })

  it('keeps last-good claude limits with stale+error when fetchClaudeLimits resolves an error status (real contract: never throws), without touching codex', async () => {
    const deps = makeDeps()
    const poller = new Poller(deps)
    await poller.refreshNow()
    const goodClaude = poller.getState().limits.claude
    const goodCodex = poller.getState().limits.codex

    ;(deps.fetchClaudeLimits as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      provider: 'claude',
      windows: [],
      fetchedAt: 999,
      error: 'network'
    })
    await poller.refreshNow()

    const state = poller.getState()
    expect(state.limits.claude).toEqual({ ...goodClaude, stale: true, error: 'network' })
    expect(state.limits.codex).toEqual(goodCodex)
  })

  it('defensive: keeps last-good + stale even if a dep unexpectedly rejects instead of resolving an error status', async () => {
    const deps = makeDeps()
    const poller = new Poller(deps)
    await poller.refreshNow()
    const goodClaude = poller.getState().limits.claude

    ;(deps.fetchClaudeLimits as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'))
    await poller.refreshNow()

    expect(poller.getState().limits.claude).toEqual({
      ...goodClaude,
      stale: true,
      error: 'network'
    })
  })

  it('does not treat a resolved codex stale:true (old-but-valid data) as a failure', async () => {
    const deps = makeDeps()
    ;(deps.readCodexLimits as ReturnType<typeof vi.fn>).mockResolvedValue(
      codexStatus({ stale: true })
    )
    const poller = new Poller(deps)
    await poller.refreshNow()

    expect(poller.getState().limits.codex).toEqual(codexStatus({ stale: true }))
    expect(deps.recordSnapshots).toHaveBeenCalledWith(deps.db, codexStatus({ stale: true }))
  })

  it('retries limits every 60s while failing (fixed, not exponential), then resumes the 5min base after success', async () => {
    vi.useFakeTimers()
    const deps = makeDeps()
    const errorStatus: RateStatus = {
      provider: 'claude',
      windows: [],
      fetchedAt: 1,
      error: 'network'
    }
    ;(deps.fetchClaudeLimits as ReturnType<typeof vi.fn>).mockResolvedValue(errorStatus)
    const poller = new Poller(deps)
    poller.start()

    await vi.advanceTimersByTimeAsync(0) // tick 1 fails -> next delay fixed at 60_000 retry (not base 300_000)
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000) // total 60_000 -> tick 2 fires and fails -> stays at 60_000 retry
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(2)

    // now let it succeed -> next delay should return to base 300_000
    ;(deps.fetchClaudeLimits as ReturnType<typeof vi.fn>).mockResolvedValue(claudeStatus())
    await vi.advanceTimersByTimeAsync(60_000) // total 120_000 -> tick 3 fires (still on retry interval) and succeeds
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(60_000) // only 60s since success -> not due yet (base is 300s)
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(240_000) // total 300_000 since tick 3's success -> tick 4 due at base
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(4)

    poller.stop()
  })

  describe('nextLimitsDelay (pure limits scheduling formula)', () => {
    it('returns the base interval with no failures', () => {
      expect(nextLimitsDelay(5 * 60_000, 0)).toBe(5 * 60_000)
    })
    it('fixes the retry interval (not exponential) while failing', () => {
      expect(nextLimitsDelay(5 * 60_000, 1)).toBe(60_000)
      expect(nextLimitsDelay(5 * 60_000, 2)).toBe(60_000)
      expect(nextLimitsDelay(5 * 60_000, 10)).toBe(60_000)
    })
    it('keeps the (shorter) base interval instead of the retry interval when base < retry', () => {
      expect(nextLimitsDelay(15_000, 1)).toBe(15_000)
    })
  })

  it('runs a usage tick: 4x runCcusage, normalize, upsertDaily/Sessions, re-query today', async () => {
    const deps = makeDeps()
    const poller = new Poller(deps)
    await poller.refreshNow()

    expect(deps.runCcusage).toHaveBeenCalledWith(['claude', 'daily', '--json'])
    expect(deps.runCcusage).toHaveBeenCalledWith(['codex', 'daily', '--json'])
    expect(deps.runCcusage).toHaveBeenCalledWith(['claude', 'session', '--json'])
    expect(deps.runCcusage).toHaveBeenCalledWith(['codex', 'session', '--json'])
    expect(deps.normalizeDaily).toHaveBeenCalledWith('claude', expect.anything())
    expect(deps.normalizeDaily).toHaveBeenCalledWith('codex', expect.anything())
    expect(deps.upsertDaily).toHaveBeenCalledTimes(1)
    expect(deps.upsertSessions).toHaveBeenCalledTimes(1)
    expect(deps.todayByProvider).toHaveBeenCalledTimes(1)
    expect(poller.getState().lastUsageSyncAt).not.toBeNull()
  })

  it('records a rate snapshot per successful provider limits fetch', async () => {
    const deps = makeDeps()
    const poller = new Poller(deps)
    await poller.refreshNow()

    expect(deps.recordSnapshots).toHaveBeenCalledTimes(2)
    expect(deps.recordSnapshots).toHaveBeenCalledWith(deps.db, claudeStatus())
    expect(deps.recordSnapshots).toHaveBeenCalledWith(deps.db, codexStatus())
  })

  it('emits a state event after each tick', async () => {
    const deps = makeDeps()
    const poller = new Poller(deps)
    const listener = vi.fn()
    poller.on('state', listener)
    await poller.refreshNow()

    expect(listener).toHaveBeenCalled()
    const lastCallArg = listener.mock.calls[listener.mock.calls.length - 1][0]
    expect(lastCallArg.limits.claude).toEqual(claudeStatus())
  })

  it('does not start a second usage tick while one is still in flight', async () => {
    const deps = makeDeps()
    const resolvers: Array<(v: unknown) => void> = []
    ;(deps.runCcusage as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    )
    const poller = new Poller(deps)

    const first = poller.refreshNow()
    const second = poller.refreshNow() // should short-circuit: a usage tick is already in flight
    resolvers.forEach((resolve) => resolve({ daily: [], sessions: [] }))
    await Promise.all([first, second])

    // 4 ccusage calls for one usage tick; the concurrent refreshNow should not add a second usage tick's calls
    expect(deps.runCcusage).toHaveBeenCalledTimes(4)
  })

  it('a throwing state listener does not kill the polling loop (both loops re-arm)', async () => {
    vi.useFakeTimers()
    const deps = makeDeps()
    const poller = new Poller(deps)
    poller.on('state', () => {
      throw new Error('listener boom')
    })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(1)
    expect(deps.runCcusage).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(5 * 60_000) // both loops survived the throw and re-armed at the shared 5min base
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(2)
    expect(deps.runCcusage).toHaveBeenCalledTimes(8)
    poller.stop()
  })

  it('claude usage still persists when the codex CLI fails (partial-failure isolation)', async () => {
    const deps = makeDeps()
    const claudeRow = {
      date: '2026-07-13',
      provider: 'claude' as const,
      model: 'opus',
      inputTokens: 1,
      outputTokens: 2,
      cacheTokens: 3,
      costUsd: 4
    }
    ;(deps.runCcusage as ReturnType<typeof vi.fn>).mockImplementation((args: string[]) =>
      args[0] === 'codex'
        ? Promise.reject(new Error('cli boom'))
        : Promise.resolve({ daily: [], sessions: [] })
    )
    ;(deps.normalizeDaily as ReturnType<typeof vi.fn>).mockReturnValue([claudeRow])
    const poller = new Poller(deps)
    await poller.refreshNow()

    expect(deps.normalizeDaily).toHaveBeenCalledWith('claude', expect.anything())
    expect(deps.normalizeDaily).not.toHaveBeenCalledWith('codex', expect.anything())
    expect(deps.upsertDaily).toHaveBeenCalledWith(deps.db, [claudeRow])
    expect(deps.upsertSessions).toHaveBeenCalledTimes(1)
    expect(poller.getState().lastUsageSyncAt).not.toBeNull()
  })

  it('recordSnapshots failure does not mark the fetch failed or trigger backoff', async () => {
    vi.useFakeTimers()
    const deps = makeDeps()
    ;(deps.recordSnapshots as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('db boom')
    })
    const poller = new Poller(deps)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    // fetch 자체는 성공 — stale/error 없이 그대로 반영돼야 한다
    expect(poller.getState().limits.claude).toEqual(claudeStatus())
    expect(poller.getState().limits.codex).toEqual(codexStatus())

    await vi.advanceTimersByTimeAsync(5 * 60_000) // 백오프 없이 기본 5분(300s)에 다음 틱
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('stop() prevents further scheduled ticks', async () => {
    vi.useFakeTimers()
    const deps = makeDeps()
    const poller = new Poller(deps)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    const callsAfterStart = (deps.fetchClaudeLimits as ReturnType<typeof vi.fn>).mock.calls.length

    poller.stop()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(callsAfterStart)
  })

  describe('멀티 계정 통합', () => {
    it('wham 성공 시 rollout을 호출하지 않고 wham 상태를 쓴다', async () => {
      const readCodexLimits = vi.fn()
      const deps = makeDeps({
        fetchCodexUsage: async () => ({
          account: { id: 'cx', email: 'c@c.com' },
          status: codexStatus()
        }),
        readCodexLimits
      })
      const poller = new Poller(deps)
      await poller.refreshNow()
      expect(readCodexLimits).not.toHaveBeenCalled()
      expect(poller.getState().limits.codex).toEqual(codexStatus())
    })

    it('wham 에러·rollout 정상 → rollout 채택(폴백)', async () => {
      const deps = makeDeps({
        fetchCodexUsage: async () => ({
          account: null,
          status: {
            provider: 'codex' as const,
            windows: [],
            fetchedAt: 1,
            error: 'network' as const
          }
        }),
        readCodexLimits: async () => codexStatus({ stale: true })
      })
      const poller = new Poller(deps)
      await poller.refreshNow()
      expect(poller.getState().limits.codex).toEqual(codexStatus({ stale: true }))
    })

    it('accountsCycle 결과가 state.accounts에 실리고, cycle throw는 limits를 깨지 않는다', async () => {
      const entry = {
        account: { provider: 'claude' as const, id: 'a', email: 'a@a.com' },
        status: claudeStatus(),
        live: true,
        lastSeenAt: 1
      }
      const deps = makeDeps({ accountsCycle: async () => [entry] })
      const poller = new Poller(deps)
      await poller.refreshNow()
      expect(poller.getState().accounts).toEqual([entry])

      const deps2 = makeDeps({
        accountsCycle: async () => {
          throw new Error('boom')
        }
      })
      const poller2 = new Poller(deps2)
      await poller2.refreshNow()
      expect(poller2.getState().limits.claude).toEqual(claudeStatus()) // limits 정상
      expect(poller2.getState().accounts).toEqual([]) // 이전값(초기 []) 유지
    })

    it('accountsCycle 있으면 poller의 직접 recordSnapshots를 건너뛴다(이중 기록 금지)', async () => {
      const recordSnapshots = vi.fn()
      const deps = makeDeps({ recordSnapshots, accountsCycle: async () => [] })
      const poller = new Poller(deps)
      await poller.refreshNow()
      expect(recordSnapshots).not.toHaveBeenCalled()
    })
  })
})
