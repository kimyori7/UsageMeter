// app/src/providers/codex/auth.test.ts
// 실계정 파일(~/.codex)은 절대 접근하지 않는다 — temp 디렉터리 + FAKE 문자열만.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readCodexAuth } from './auth'

let dir: string
function writeAuth(content: string): string {
  dir = mkdtempSync(join(tmpdir(), 'codex-auth-'))
  const p = join(dir, 'auth.json')
  writeFileSync(p, content, 'utf-8')
  return p
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('readCodexAuth', () => {
  it('tokens에서 accessToken/accountId를 읽는다', () => {
    const p = writeAuth(
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          id_token: 'FAKE-ID',
          access_token: 'FAKE-ACCESS',
          refresh_token: 'FAKE-REFRESH',
          account_id: 'acc-123'
        },
        last_refresh: '2026-07-12T00:00:00Z'
      })
    )
    expect(readCodexAuth(p)).toEqual({ accessToken: 'FAKE-ACCESS', accountId: 'acc-123' })
  })

  it('파일 없음 → null', () => {
    expect(readCodexAuth(join(tmpdir(), 'no-such-dir', 'auth.json'))).toBeNull()
  })

  it('JSON 파싱 실패 → null', () => {
    expect(readCodexAuth(writeAuth('not-json{{{'))).toBeNull()
  })

  it('tokens 없음(API 키 전용 auth) → null', () => {
    expect(readCodexAuth(writeAuth(JSON.stringify({ OPENAI_API_KEY: 'FAKE-KEY' })))).toBeNull()
  })

  it('account_id 결측 → null', () => {
    expect(
      readCodexAuth(writeAuth(JSON.stringify({ tokens: { access_token: 'FAKE-ACCESS' } })))
    ).toBeNull()
  })
})
