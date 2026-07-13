import { describe, it, expect, vi } from 'vitest'
import { fetchClaudeLimits } from './limits'

const okBody = {
  five_hour: { utilization: 68, resets_at: '2026-07-13T09:00:00Z' },
  seven_day: { utilization: 41, resets_at: '2026-07-17T00:00:00Z' },
  subscriptionType: 'max_20x',
}
const mkFetch = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('fetchClaudeLimits', () => {
  it('maps five_hour/seven_day to RateWindows', async () => {
    const s = await fetchClaudeLimits({ token: 'tok', fetchFn: mkFetch(200, okBody) })
    expect(s.windows).toEqual([
      { kind: 'session_5h', usedPercent: 68, resetsAt: Date.parse('2026-07-13T09:00:00Z') / 1000 },
      { kind: 'weekly', usedPercent: 41, resetsAt: Date.parse('2026-07-17T00:00:00Z') / 1000 },
    ])
    expect(s.error).toBeUndefined()
  })
  it('five_hour 부재 시 있는 창만', async () => {
    const s = await fetchClaudeLimits({ token: 'tok', fetchFn: mkFetch(200, { seven_day: okBody.seven_day }) })
    expect(s.windows.map((w) => w.kind)).toEqual(['weekly'])
  })
  it('token 없으면 no-credentials', async () => {
    const s = await fetchClaudeLimits({ token: null, fetchFn: mkFetch(200, okBody) })
    expect(s.error).toBe('no-credentials')
    expect(s.windows).toEqual([])
  })
  it('401/403 → unauthorized', async () => {
    const s = await fetchClaudeLimits({ token: 'bad', fetchFn: mkFetch(401, {}) })
    expect(s.error).toBe('unauthorized')
  })
  it('네트워크 예외 → network', async () => {
    const s = await fetchClaudeLimits({
      token: 'tok',
      fetchFn: vi.fn(async () => {
        throw new Error('ECONN')
      }) as unknown as typeof fetch,
    })
    expect(s.error).toBe('network')
  })
})
