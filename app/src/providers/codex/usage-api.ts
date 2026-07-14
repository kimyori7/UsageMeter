// app/src/providers/codex/usage-api.ts
// 코덱스 능동 한도 API (스펙 F2). 창 매핑: limit_window_seconds 18000→session_5h, 604800→weekly.
// providers 계약: 절대 throw하지 않고 RateStatus.error로 실패를 알린다.
import type { RateStatus, RateWindow } from '../types'
import { readCodexAuth, type CodexAuth } from './auth'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

export interface CodexAccountIdentity {
  id: string
  email: string
  plan?: string
}

export interface CodexUsageResult {
  account: CodexAccountIdentity | null
  status: RateStatus
}

function windowKind(seconds: unknown): RateWindow['kind'] | null {
  if (seconds === 18000) return 'session_5h'
  if (seconds === 604800) return 'weekly'
  return null
}

function toWindow(raw: unknown): RateWindow | null {
  const r = raw as
    | { used_percent?: unknown; limit_window_seconds?: unknown; reset_at?: unknown }
    | null
    | undefined
  if (!r || typeof r.used_percent !== 'number') return null
  const kind = windowKind(r.limit_window_seconds)
  if (!kind) return null
  return {
    kind,
    usedPercent: r.used_percent,
    resetsAt: typeof r.reset_at === 'number' ? r.reset_at : 0
  }
}

export async function fetchCodexUsage(
  deps: { auth?: CodexAuth | null; fetchFn?: typeof fetch; authPath?: string } = {}
): Promise<CodexUsageResult> {
  const auth = deps.auth !== undefined ? deps.auth : readCodexAuth(deps.authPath)
  const fetchFn = deps.fetchFn ?? fetch
  const base: RateStatus = { provider: 'codex', windows: [], fetchedAt: Date.now() }
  if (!auth) return { account: null, status: { ...base, error: 'no-credentials' } }

  let res: Response
  try {
    res = await fetchFn(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'chatgpt-account-id': auth.accountId,
        'User-Agent': 'codex-cli'
      }
    })
  } catch {
    return { account: null, status: { ...base, error: 'network' } }
  }
  if (res.status === 401 || res.status === 403)
    return { account: null, status: { ...base, error: 'unauthorized' } }
  if (!res.ok) return { account: null, status: { ...base, error: 'network' } }

  let body: {
    account_id?: unknown
    email?: unknown
    plan_type?: unknown
    rate_limit?: { primary_window?: unknown; secondary_window?: unknown } | null
  }
  try {
    body = await res.json()
  } catch {
    return { account: null, status: { ...base, error: 'network' } }
  }

  const account: CodexAccountIdentity = {
    id: typeof body.account_id === 'string' ? body.account_id : auth.accountId,
    email: typeof body.email === 'string' ? body.email : '',
    plan: typeof body.plan_type === 'string' ? body.plan_type : undefined
  }
  const windows = [
    toWindow(body.rate_limit?.primary_window),
    toWindow(body.rate_limit?.secondary_window)
  ]
    .filter((w): w is RateWindow => w !== null)
    // 표시 순서 고정: 세션 → 주간 (codex/limits.ts와 동일 규칙)
    .sort((a, b) => (a.kind === 'session_5h' ? -1 : 1) - (b.kind === 'session_5h' ? -1 : 1))

  return {
    account,
    status: {
      ...base,
      windows,
      plan: account.plan,
      ...(windows.length === 0 ? { error: 'no-data' as const } : {})
    }
  }
}
