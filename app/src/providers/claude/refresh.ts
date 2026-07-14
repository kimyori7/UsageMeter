import { DEFAULT_CRED_PATH, readClaudeCredentials, writeClaudeOAuthUpdate } from './credentials'

// Claude Code CLI가 사용하는 공개 OAuth client id. 앱 자체 발급 client가 아니라 Claude Code와
// 동일한 값을 써야 refresh_token grant가 그 세션과 호환된다.
export const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

const REFRESH_URL = 'https://console.anthropic.com/v1/oauth/token'
const SKEW_MS = 5 * 60 * 1000 // 만료 5분 전부터 "곧 만료"로 취급해 미리 갱신

interface FreshResult {
  accessToken: string
  expiresAt: number // epoch-ms
}

// credPath별 최근 성공한 갱신 결과. 토큰 값은 이 모듈 경계 밖(로그/IPC/에러메시지)으로 절대 내보내지 말 것.
const freshCache = new Map<string, FreshResult>()
// credPath별 진행 중인 갱신 요청 — 동시 호출을 하나의 네트워크 요청으로 합친다(single-flight).
const inflightRefresh = new Map<string, Promise<FreshResult | null>>()

/** expiresAt이 없으면(필드 미존재 등) 판정 불가로 보고 그대로 신선하다고 취급한다(갱신 시도 안 함). */
function isStillFresh(expiresAt: number | null, nowMs: number): boolean {
  if (typeof expiresAt !== 'number') return true
  return expiresAt - SKEW_MS > nowMs
}

async function requestRefresh(
  credPath: string,
  raw: Record<string, unknown>,
  refreshToken: string,
  fetchFn: typeof fetch,
  now: () => number
): Promise<FreshResult | null> {
  try {
    const res = await fetchFn(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLAUDE_CODE_CLIENT_ID
      })
    })
    if (!res.ok) return null

    let body: unknown
    try {
      body = await res.json()
    } catch {
      return null
    }
    const parsed = body as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    if (typeof parsed.access_token !== 'string' || typeof parsed.expires_in !== 'number')
      return null

    const expiresAt = now() + parsed.expires_in * 1000
    const rotatedRefreshToken =
      typeof parsed.refresh_token === 'string' ? parsed.refresh_token : undefined

    // 회전(refresh_token 포함) 시 파일에 반영, 없으면 access/expiresAt만 — 원본 구조는 보존.
    writeClaudeOAuthUpdate(credPath, raw, {
      accessToken: parsed.access_token,
      refreshToken: rotatedRefreshToken,
      expiresAt
    })
    return { accessToken: parsed.access_token, expiresAt }
  } catch {
    return null
  }
}

/**
 * 파일의 access token이 아직 유효하면(만료까지 SKEW_MS 초과) 네트워크 없이 그대로 반환한다.
 * 만료(임박)했고 refreshToken이 있으면 Anthropic OAuth 토큰 엔드포인트로 갱신을 시도하고,
 * 성공하면 파일에 원자적으로 반영한 뒤 새 access token을 반환한다.
 * 실패(4xx/5xx/네트워크 오류/응답 파싱 실패)해도 절대 throw하지 않고 null을 반환하며 파일은 그대로 둔다.
 * 동시 호출은 같은 갱신 요청을 공유한다(single-flight).
 */
export async function ensureFreshToken(
  deps: { credPath?: string; fetchFn?: typeof fetch; now?: () => number } = {}
): Promise<string | null> {
  const credPath = deps.credPath ?? DEFAULT_CRED_PATH
  const fetchFn = deps.fetchFn ?? fetch
  const now = deps.now ?? Date.now

  const file = readClaudeCredentials(credPath)
  if (!file) return null

  const nowMs = now()
  const cached = freshCache.get(credPath)

  // 파일과 메모리 캐시 중 expiresAt이 더 미래인 쪽을 신뢰한다(외부에서 파일이 갱신됐을 수 있으므로).
  let currentToken = file.oauth.accessToken
  let currentExpiresAt = file.oauth.expiresAt
  if (cached && cached.expiresAt > (file.oauth.expiresAt ?? -Infinity)) {
    currentToken = cached.accessToken
    currentExpiresAt = cached.expiresAt
  }

  if (isStillFresh(currentExpiresAt, nowMs)) return currentToken

  if (!file.oauth.refreshToken) return currentToken // 갱신 불가 — 있는 그대로 반환(호출자가 401로 판정)

  let pending = inflightRefresh.get(credPath)
  if (!pending) {
    pending = requestRefresh(credPath, file.raw, file.oauth.refreshToken, fetchFn, now).finally(
      () => {
        inflightRefresh.delete(credPath)
      }
    )
    inflightRefresh.set(credPath, pending)
  }

  const result = await pending
  if (!result) return null
  freshCache.set(credPath, result)
  return result.accessToken
}
