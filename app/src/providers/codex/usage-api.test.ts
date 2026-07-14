import { describe, expect, it, vi } from 'vitest'
import { fetchCodexUsage } from './usage-api'

const AUTH = { accessToken: 'FAKE-ACCESS', accountId: 'acc-123' }

function okBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account_id: 'acc-123',
    email: 'user@example.com',
    plan_type: 'plus',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 25,
        limit_window_seconds: 18000,
        reset_after_seconds: 100,
        reset_at: 1800000100
      },
      secondary_window: {
        used_percent: 40,
        limit_window_seconds: 604800,
        reset_after_seconds: 200,
        reset_at: 1800000200
      }
    },
    ...overrides
  }
}
const jsonRes = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

describe('fetchCodexUsage', () => {
  it('URL·헤더(Bearer/account-id/UA)를 정확히 보내고 창을 매핑한다', async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, okBody()))
    const r = await fetchCodexUsage({ auth: AUTH, fetchFn })
    expect(fetchFn).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer FAKE-ACCESS',
          'chatgpt-account-id': 'acc-123',
          'User-Agent': 'codex-cli'
        }
      })
    )
    expect(r.account).toEqual({ id: 'acc-123', email: 'user@example.com', plan: 'plus' })
    expect(r.status.provider).toBe('codex')
    expect(r.status.error).toBeUndefined()
    expect(r.status.plan).toBe('plus')
    expect(r.status.windows).toEqual([
      { kind: 'session_5h', usedPercent: 25, resetsAt: 1800000100 },
      { kind: 'weekly', usedPercent: 40, resetsAt: 1800000200 }
    ])
  })

  it('secondary_window null(실측 케이스) → 세션 창만', async () => {
    const body = okBody()
    ;(body.rate_limit as Record<string, unknown>).secondary_window = null
    const r = await fetchCodexUsage({ auth: AUTH, fetchFn: async () => jsonRes(200, body) })
    expect(r.status.windows).toHaveLength(1)
    expect(r.status.windows[0].kind).toBe('session_5h')
    expect(r.status.error).toBeUndefined()
  })

  it('401 → unauthorized (계정 null)', async () => {
    const r = await fetchCodexUsage({ auth: AUTH, fetchFn: async () => jsonRes(401, {}) })
    expect(r.status.error).toBe('unauthorized')
    expect(r.account).toBeNull()
  })

  it('5xx → network / fetch throw → network / JSON 파싱 실패 → network', async () => {
    expect(
      (await fetchCodexUsage({ auth: AUTH, fetchFn: async () => jsonRes(503, {}) })).status.error
    ).toBe('network')
    expect(
      (
        await fetchCodexUsage({
          auth: AUTH,
          fetchFn: async () => {
            throw new Error('boom')
          }
        })
      ).status.error
    ).toBe('network')
    const badJson = {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad')
      }
    } as unknown as Response
    expect((await fetchCodexUsage({ auth: AUTH, fetchFn: async () => badJson })).status.error).toBe(
      'network'
    )
  })

  it('rate_limit 결측 → no-data (계정 신원은 유지)', async () => {
    const r = await fetchCodexUsage({
      auth: AUTH,
      fetchFn: async () => jsonRes(200, okBody({ rate_limit: null }))
    })
    expect(r.status.error).toBe('no-data')
    expect(r.account?.email).toBe('user@example.com')
  })

  it('auth: null 주입 → no-credentials, fetch 미호출', async () => {
    const fetchFn = vi.fn()
    const r = await fetchCodexUsage({ auth: null, fetchFn })
    expect(r.status.error).toBe('no-credentials')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
