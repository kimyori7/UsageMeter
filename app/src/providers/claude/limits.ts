import type { RateStatus, RateWindow } from '../types'
import { readAccessToken } from './credentials'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

function toEpochSec(v: unknown): number {
  if (typeof v === 'number') return v > 1e12 ? Math.round(v / 1000) : v
  const t = Date.parse(String(v))
  return Number.isNaN(t) ? 0 : t / 1000
}

function win(kind: RateWindow['kind'], raw: unknown): RateWindow | null {
  const r = raw as { utilization?: unknown; resets_at?: unknown } | null | undefined
  if (!r || typeof r.utilization !== 'number') return null
  return { kind, usedPercent: r.utilization, resetsAt: toEpochSec(r.resets_at) }
}

export async function fetchClaudeLimits(
  deps: { token?: string | null; fetchFn?: typeof fetch } = {},
): Promise<RateStatus> {
  const token = deps.token !== undefined ? deps.token : readAccessToken()
  const fetchFn = deps.fetchFn ?? fetch
  const base: RateStatus = { provider: 'claude', windows: [], fetchedAt: Date.now() }
  if (!token) return { ...base, error: 'no-credentials' }

  let res: Response
  try {
    res = await fetchFn(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
    })
  } catch {
    return { ...base, error: 'network' }
  }
  if (res.status === 401 || res.status === 403) return { ...base, error: 'unauthorized' }
  if (!res.ok) return { ...base, error: 'network' }

  const body = (await res.json()) as {
    five_hour?: unknown
    seven_day?: unknown
    subscriptionType?: string
  }
  const windows = [win('session_5h', body.five_hour), win('weekly', body.seven_day)].filter(
    (w): w is RateWindow => w !== null,
  )
  return {
    ...base,
    windows,
    plan: body.subscriptionType ?? undefined,
    ...(windows.length === 0 ? { error: 'no-data' as const } : {}),
  }
}
