import { describe, it, expect, vi, afterEach } from 'vitest'
import { openDb } from '../store/db'
import { Poller, nextDelay, type PollerDeps } from './poller'
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

function makeDeps(): PollerDeps {
  return {
    db: openDb(':memory:'),
    fetchClaudeLimits: vi.fn().mockResolvedValue(claudeStatus()),
    readCodexLimits: vi.fn().mockResolvedValue(codexStatus()),
    runCcusage: vi.fn().mockResolvedValue({ daily: [], sessions: [] }),
    normalizeDaily: vi.fn().mockReturnValue([]),
    normalizeSessions: vi.fn().mockReturnValue([]),
    upsertDaily: vi.fn(),
    upsertSessions: vi.fn(),
    recordSnapshots: vi.fn(),
    todayByProvider: vi.fn().mockReturnValue({
      claude: { costUsd: 0, totalTokens: 0 },
      codex: { costUsd: 0, totalTokens: 0 }
    })
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

  it('re-polls limits after 60s', async () => {
    vi.useFakeTimers()
    const deps = makeDeps()
    const poller = new Poller(deps)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
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

    await vi.advanceTimersByTimeAsync(60_000) // one more limits tick, no usage yet
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

  it('doubles the next limits interval after consecutive failures, capped, and resets after success', async () => {
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

    await vi.advanceTimersByTimeAsync(0) // tick 1 fails -> next delay 120_000
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000) // not due yet (would've been due at 60_000 without backoff)
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000) // total 120_000 -> tick 2 fires and fails -> next delay 240_000
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(2)

    // now let it succeed -> backoff should reset to base 60_000
    ;(deps.fetchClaudeLimits as ReturnType<typeof vi.fn>).mockResolvedValue(claudeStatus())
    await vi.advanceTimersByTimeAsync(240_000) // total 360_000 -> tick 3 fires and succeeds
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(60_000) // reset interval -> tick 4 due at base 60_000
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(4)

    poller.stop()
  })

  describe('nextDelay (pure backoff formula)', () => {
    it('returns the base interval with no failures', () => {
      expect(nextDelay(60_000, 0)).toBe(60_000)
    })
    it('doubles per consecutive failure', () => {
      expect(nextDelay(60_000, 1)).toBe(120_000)
      expect(nextDelay(60_000, 2)).toBe(240_000)
      expect(nextDelay(60_000, 3)).toBe(480_000)
    })
    it('caps at 15 minutes', () => {
      expect(nextDelay(60_000, 4)).toBe(15 * 60_000) // uncapped would be 960_000
      expect(nextDelay(60_000, 10)).toBe(15 * 60_000)
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

    await vi.advanceTimersByTimeAsync(60_000) // limits loop survived the throw
    expect(deps.fetchClaudeLimits).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(240_000) // usage loop survived too (total 300s)
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

    await vi.advanceTimersByTimeAsync(60_000) // 백오프 없이 기본 60s에 다음 틱
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
})
