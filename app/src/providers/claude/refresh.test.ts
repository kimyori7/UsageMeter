import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_CODE_CLIENT_ID, ensureFreshToken } from './refresh'

// 모든 토큰 값은 명백한 가짜 문자열(FAKE-*)이다. 실계정 파일(~/.claude)은 이 테스트에서 절대 건드리지 않는다
// — credPath는 매번 새로 만든 임시 디렉터리를 가리키고, 실제 홈 디렉터리 기본값(DEFAULT_CRED_PATH)은 쓰지 않는다.

const NOW = 1_800_000_000_000 // 고정 기준 시각(epoch-ms)
const fixedNow = (): number => NOW
const FIVE_MIN_MS = 5 * 60 * 1000

function credFixture(oauthOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claudeAiOauth: {
      accessToken: 'FAKE-ACCESS-OLD',
      refreshToken: 'FAKE-REFRESH-OLD',
      expiresAt: NOW - 1_000, // 기본값: 이미 만료
      scopes: ['user:inference', 'user:profile'],
      subscriptionType: 'max',
      ...oauthOverrides
    },
    unrelatedField: { keep: 'me', korean: '한글 값도 보존되어야 함' } // 구조 보존 검증용 미지 필드
  }
}

const rotatedRefreshBody = {
  access_token: 'FAKE-ACCESS-NEW',
  refresh_token: 'FAKE-REFRESH-NEW',
  expires_in: 28800
}

function fetchReturning(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

let dir: string
let credPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'usagemeter-refresh-test-'))
  credPath = join(dir, '.credentials.json') // 테스트마다 새 경로 → 모듈 내 credPath-keyed 캐시/single-flight도 자연히 격리됨
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeCredFile(obj: unknown): void {
  writeFileSync(credPath, JSON.stringify(obj))
}

function readCredFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(credPath, 'utf-8'))
}

describe('ensureFreshToken: 아직 유효하면 네트워크를 타지 않는다', () => {
  it('만료까지 5분 넘게 남았으면 파일의 accessToken을 그대로 반환한다', async () => {
    writeCredFile(credFixture({ expiresAt: NOW + 10 * 60_000 }))
    const fetchFn = fetchReturning(200, rotatedRefreshBody)
    const token = await ensureFreshToken({
      credPath,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: fixedNow
    })
    expect(token).toBe('FAKE-ACCESS-OLD')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('expiresAt 필드가 없으면 만료 여부를 판정할 수 없으므로 그대로 반환한다', async () => {
    writeCredFile(credFixture({ expiresAt: undefined }))
    const fetchFn = fetchReturning(200, rotatedRefreshBody)
    const token = await ensureFreshToken({
      credPath,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: fixedNow
    })
    expect(token).toBe('FAKE-ACCESS-OLD')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('만료됐지만 refreshToken이 없으면 갱신을 시도하지 않고 있는 그대로 반환한다', async () => {
    writeCredFile(credFixture({ refreshToken: undefined }))
    const fetchFn = fetchReturning(200, rotatedRefreshBody)
    const token = await ensureFreshToken({
      credPath,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: fixedNow
    })
    expect(token).toBe('FAKE-ACCESS-OLD')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('크리덴셜 파일이 없으면 null을 반환한다', async () => {
    const fetchFn = fetchReturning(200, rotatedRefreshBody)
    const token = await ensureFreshToken({
      credPath,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: fixedNow
    })
    expect(token).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('ensureFreshToken: 만료(임박) 시 갱신 요청', () => {
  it('POST 페이로드가 endpoint/method/헤더/본문 모두 정확하다', async () => {
    writeCredFile(credFixture())
    const fetchFn = fetchReturning(200, rotatedRefreshBody)
    await ensureFreshToken({ credPath, fetchFn: fetchFn as unknown as typeof fetch, now: fixedNow })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> }
    ]
    expect(url).toBe('https://console.anthropic.com/v1/oauth/token')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'FAKE-REFRESH-OLD',
      client_id: CLAUDE_CODE_CLIENT_ID
    })
  })

  it('만료까지 5분 미만(임박)이어도 갱신 대상이다', async () => {
    writeCredFile(credFixture({ expiresAt: NOW + FIVE_MIN_MS - 60_000 }))
    const fetchFn = fetchReturning(200, rotatedRefreshBody)
    const token = await ensureFreshToken({
      credPath,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: fixedNow
    })
    expect(token).toBe('FAKE-ACCESS-NEW')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('refresh_token이 회전된 응답이면 access/refresh/expiresAt을 파일에 반영하고 나머지 구조·tmp 잔재 없이 보존한다', async () => {
    writeCredFile(credFixture())
    const token = await ensureFreshToken({
      credPath,
      fetchFn: fetchReturning(200, rotatedRefreshBody) as unknown as typeof fetch,
      now: fixedNow
    })
    expect(token).toBe('FAKE-ACCESS-NEW')

    const updated = readCredFile()
    expect(updated).toEqual({
      claudeAiOauth: {
        accessToken: 'FAKE-ACCESS-NEW',
        refreshToken: 'FAKE-REFRESH-NEW',
        expiresAt: NOW + 28800 * 1000,
        scopes: ['user:inference', 'user:profile'],
        subscriptionType: 'max'
      },
      unrelatedField: { keep: 'me', korean: '한글 값도 보존되어야 함' }
    })
    expect(readdirSync(dir)).toEqual(['.credentials.json']) // 원자 쓰기: temp 파일 잔재가 없어야 함
  })

  it('refresh_token이 없는 응답(비회전)이면 accessToken/expiresAt만 갱신하고 기존 refreshToken을 유지한다', async () => {
    writeCredFile(credFixture())
    const token = await ensureFreshToken({
      credPath,
      fetchFn: fetchReturning(200, {
        access_token: 'FAKE-ACCESS-NEW',
        expires_in: 3600
      }) as unknown as typeof fetch,
      now: fixedNow
    })
    expect(token).toBe('FAKE-ACCESS-NEW')

    const oauth = readCredFile().claudeAiOauth as Record<string, unknown>
    expect(oauth.accessToken).toBe('FAKE-ACCESS-NEW')
    expect(oauth.refreshToken).toBe('FAKE-REFRESH-OLD')
    expect(oauth.expiresAt).toBe(NOW + 3600 * 1000)
  })
})

describe('ensureFreshToken: 실패는 항상 null + 파일 불변 (throw 절대 금지)', () => {
  const cases: Array<[string, () => typeof fetch]> = [
    ['4xx 응답', () => fetchReturning(400, { error: 'invalid_grant' }) as unknown as typeof fetch],
    ['5xx 응답', () => fetchReturning(500, {}) as unknown as typeof fetch],
    [
      'fetch가 예외를 던짐(네트워크 오류)',
      () =>
        vi.fn(async () => {
          throw new Error('ECONNRESET')
        }) as unknown as typeof fetch
    ],
    [
      '200이지만 본문이 JSON이 아님',
      () => vi.fn(async () => new Response('not-json', { status: 200 })) as unknown as typeof fetch
    ],
    [
      '200이지만 access_token 필드가 없음',
      () => fetchReturning(200, { expires_in: 3600 }) as unknown as typeof fetch
    ],
    [
      '200이지만 expires_in이 숫자가 아님',
      () =>
        fetchReturning(200, {
          access_token: 'FAKE-X',
          expires_in: 'soon'
        }) as unknown as typeof fetch
    ]
  ]

  for (const [label, makeFetchFn] of cases) {
    it(`${label} → null 반환, 파일 바이트 그대로`, async () => {
      writeCredFile(credFixture())
      const before = readFileSync(credPath, 'utf-8')
      const token = await ensureFreshToken({ credPath, fetchFn: makeFetchFn(), now: fixedNow })
      expect(token).toBeNull()
      expect(readFileSync(credPath, 'utf-8')).toBe(before)
    })
  }

  it('실패 후에도 single-flight가 풀려서 다음 호출은 다시 네트워크를 시도한다', async () => {
    writeCredFile(credFixture())
    const fetchFn = fetchReturning(500, {})
    const deps = { credPath, fetchFn: fetchFn as unknown as typeof fetch, now: fixedNow }
    expect(await ensureFreshToken(deps)).toBeNull()
    expect(await ensureFreshToken(deps)).toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('ensureFreshToken: single-flight와 캐시', () => {
  it('동시에 호출해도 갱신 네트워크 요청은 1회만 나가고, 둘 다 같은 새 토큰을 받는다', async () => {
    writeCredFile(credFixture())
    let releaseGate!: (res: Response) => void
    const gate = new Promise<Response>((resolve) => {
      releaseGate = resolve
    })
    const fetchFn = vi.fn(() => gate)
    const deps = { credPath, fetchFn: fetchFn as unknown as typeof fetch, now: fixedNow }

    const first = ensureFreshToken(deps)
    const second = ensureFreshToken(deps)
    releaseGate(new Response(JSON.stringify(rotatedRefreshBody), { status: 200 }))
    const [tokenA, tokenB] = await Promise.all([first, second])

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(tokenA).toBe('FAKE-ACCESS-NEW')
    expect(tokenB).toBe('FAKE-ACCESS-NEW')
  })

  it('갱신 성공 직후 재호출은 fetch 없이(파일이 이미 신선해져서) 새 토큰을 반환한다', async () => {
    writeCredFile(credFixture())
    const fetchFn = fetchReturning(200, rotatedRefreshBody)
    const deps = { credPath, fetchFn: fetchFn as unknown as typeof fetch, now: fixedNow }
    expect(await ensureFreshToken(deps)).toBe('FAKE-ACCESS-NEW')
    expect(await ensureFreshToken(deps)).toBe('FAKE-ACCESS-NEW')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('외부(Claude Code 등)가 파일을 더 미래 expiresAt으로 갱신했다면 그 파일 값을 우선한다', async () => {
    writeCredFile(credFixture())
    const fetchFn = fetchReturning(200, rotatedRefreshBody)
    const deps = { credPath, fetchFn: fetchFn as unknown as typeof fetch, now: fixedNow }
    expect(await ensureFreshToken(deps)).toBe('FAKE-ACCESS-NEW') // 메모리 캐시 형성됨

    writeCredFile(
      credFixture({
        accessToken: 'FAKE-ACCESS-EXTERNAL',
        refreshToken: 'FAKE-REFRESH-EXTERNAL',
        expiresAt: NOW + 28800 * 1000 + 60_000 // 캐시보다 더 미래
      })
    )
    expect(await ensureFreshToken(deps)).toBe('FAKE-ACCESS-EXTERNAL')
    expect(fetchFn).toHaveBeenCalledTimes(1) // 추가 네트워크 호출 없음
  })
})
