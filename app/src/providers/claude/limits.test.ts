import { describe, it, expect, vi } from 'vitest'

// deps.token을 안 넘긴(undefined) 기본 경로만 ensureFreshToken을 거친다는 계약을 검증하기 위한 mock.
// 토큰 값은 명백한 가짜 문자열만 사용한다.
vi.mock('./refresh', () => ({ ensureFreshToken: vi.fn() }))

import { fetchClaudeLimits } from './limits'
import { ensureFreshToken } from './refresh'

const okBody = {
  five_hour: { utilization: 68, resets_at: '2026-07-13T09:00:00Z' },
  seven_day: { utilization: 41, resets_at: '2026-07-17T00:00:00Z' },
  subscriptionType: 'max_20x'
}
const mkFetch = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('fetchClaudeLimits', () => {
  it('maps five_hour/seven_day to RateWindows', async () => {
    const s = await fetchClaudeLimits({ token: 'tok', fetchFn: mkFetch(200, okBody) })
    expect(s.windows).toEqual([
      { kind: 'session_5h', usedPercent: 68, resetsAt: Date.parse('2026-07-13T09:00:00Z') / 1000 },
      { kind: 'weekly', usedPercent: 41, resetsAt: Date.parse('2026-07-17T00:00:00Z') / 1000 }
    ])
    expect(s.error).toBeUndefined()
  })
  it('five_hour 부재 시 있는 창만', async () => {
    const s = await fetchClaudeLimits({
      token: 'tok',
      fetchFn: mkFetch(200, { seven_day: okBody.seven_day })
    })
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
  it('200인데 본문이 JSON 아님 → network (reject 아님)', async () => {
    const badJsonFetch = vi.fn(
      async () => new Response('not json at all', { status: 200 })
    ) as unknown as typeof fetch
    const s = await fetchClaudeLimits({ token: 'tok', fetchFn: badJsonFetch })
    expect(s.error).toBe('network')
    expect(s.windows).toEqual([])
  })
  it('네트워크 예외 → network', async () => {
    const s = await fetchClaudeLimits({
      token: 'tok',
      fetchFn: vi.fn(async () => {
        throw new Error('ECONN')
      }) as unknown as typeof fetch
    })
    expect(s.error).toBe('network')
  })

  it('deps.token을 안 넘기면(undefined) ensureFreshToken()의 결과를 토큰으로 사용한다', async () => {
    vi.mocked(ensureFreshToken).mockResolvedValueOnce('FAKE-FRESH-TOKEN')
    const fetchFn = mkFetch(200, okBody)
    const s = await fetchClaudeLimits({ fetchFn })
    expect(ensureFreshToken).toHaveBeenCalledTimes(1)
    expect(s.error).toBeUndefined()
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { headers: Record<string, string> }
    ]
    expect(init.headers.Authorization).toBe('Bearer FAKE-FRESH-TOKEN')
  })

  it('deps.token을 안 넘겼고 ensureFreshToken()이 null이면 no-credentials', async () => {
    vi.mocked(ensureFreshToken).mockResolvedValueOnce(null)
    const s = await fetchClaudeLimits({ fetchFn: mkFetch(200, okBody) })
    expect(s.error).toBe('no-credentials')
  })
})
